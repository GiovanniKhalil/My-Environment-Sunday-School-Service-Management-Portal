import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  FilePlus2,
  MessageSquare,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import type {
  ChatChannelType,
  EnvironmentChatChannel,
  EnvironmentChatMessage,
  SessionUser,
} from '../types';
import {
  apiFetch,
  formatArabicTime,
  getSessionToken,
} from '../utils/api';
import { getCurrentOwnerFirebaseIdToken } from '../firebase';

interface UnifiedChatHubProps {
  currentUser: SessionUser;
  workspaceId?: string;
  onApproveFromChannel?: (channel: EnvironmentChatChannel) => void;
  initialChannelId?: string;
}

const ROLE_LABELS: Record<string, string> = {
  environment_owner: 'صاحب الـ Environment',
  head_servant: 'أمين فصل',
  assistant_head: 'أمين مساعد',
  servant: 'خادم',
  student: 'مخدوم',
  applicant: 'طلب خدمة جديد',
};

const CATEGORY_META: Record<
  ChatChannelType,
  { label: string; subtitle: string; icon: 'team' | 'direct' | 'group' | 'applicant' }
> = {
  workspace_internal: {
    label: 'شات الفصل الداخلي',
    subtitle: 'تواصل فريق خدام الفصل وأمين الخدمة',
    icon: 'team',
  },
  direct: {
    label: 'شات خاص مع الإدارة',
    subtitle: 'محادثة ثنائية بين أمين الفصل وصاحب المنصة',
    icon: 'direct',
  },
  group: {
    label: 'شات أمناء الفصول',
    subtitle: 'القناة الجماعية لجميع أمناء الفصول وصاحب المنصة',
    icon: 'group',
  },
  applicant_direct: {
    label: 'طلبات التأسيس الجديدة',
    subtitle: 'مناقشة طلبات إنشاء الغرف والخدمات الجديدة',
    icon: 'applicant',
  },
};

export const UnifiedChatHub: React.FC<UnifiedChatHubProps> = ({
  currentUser,
  workspaceId,
  onApproveFromChannel,
  initialChannelId,
}) => {
  const [channels, setChannels] = useState<EnvironmentChatChannel[]>([]);
  const [activeCategory, setActiveCategory] = useState<ChatChannelType>(() => {
    if (currentUser.role === 'applicant') return 'applicant_direct';
    if (workspaceId || currentUser.role === 'servant' || currentUser.role === 'assistant_head') {
      return 'workspace_internal';
    }
    return 'group';
  });
  const [activeChannelId, setActiveChannelId] = useState<string>(initialChannelId || '');
  const [messages, setMessages] = useState<EnvironmentChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const activeChannelIdRef = useRef<string>(activeChannelId);

  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);

  const availableCategories = useMemo<ChatChannelType[]>(() => {
    if (currentUser.role === 'environment_owner') {
      return workspaceId
        ? ['workspace_internal', 'direct', 'group', 'applicant_direct']
        : ['group', 'direct', 'applicant_direct', 'workspace_internal'];
    }
    if (currentUser.role === 'head_servant') {
      return ['workspace_internal', 'direct', 'group'];
    }
    if (currentUser.role === 'assistant_head' || currentUser.role === 'servant') {
      return ['workspace_internal'];
    }
    if (currentUser.role === 'applicant') {
      return ['applicant_direct'];
    }
    return [];
  }, [currentUser.role, workspaceId]);

  const loadChannels = useCallback(async () => {
    try {
      setLoadingChannels(true);
      setError('');
      const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
      const res = await apiFetch<{ channels: EnvironmentChatChannel[] }>(
        `/api/chat/channels${query}`
      );
      setChannels(res.channels);

      if (initialChannelId) {
        const target = res.channels.find((c) => c.id === initialChannelId);
        if (target) {
          setActiveCategory(target.type);
          setActiveChannelId(target.id);
          return;
        }
      }

      if (res.channels.length > 0) {
        const currentSelected = res.channels.find((c) => c.id === activeChannelIdRef.current);
        if (currentSelected) {
          setActiveCategory(currentSelected.type);
          return;
        }
        const preferredCategory =
          workspaceId && res.channels.some((c) => c.type === 'workspace_internal' && c.workspaceId === workspaceId)
            ? 'workspace_internal'
            : availableCategories.find((cat) => res.channels.some((c) => c.type === cat)) ||
              res.channels[0].type;
        setActiveCategory(preferredCategory);
        const preferredChannel =
          res.channels.find(
            (c) =>
              c.type === preferredCategory &&
              (!workspaceId || c.workspaceId === workspaceId)
          ) ||
          res.channels.find((c) => c.type === preferredCategory) ||
          res.channels[0];
        setActiveChannelId(preferredChannel.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل قنوات التواصل.');
    } finally {
      setLoadingChannels(false);
    }
  }, [workspaceId, initialChannelId, availableCategories]);

  const loadMessages = useCallback(async (channelId: string) => {
    if (!channelId) return;
    try {
      setLoadingMessages(true);
      setError('');
      const res = await apiFetch<{
        channel: EnvironmentChatChannel;
        messages: EnvironmentChatMessage[];
      }>(`/api/chat/channels/${encodeURIComponent(channelId)}/messages`);
      setMessages(res.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل الرسائل.');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    if (initialChannelId) {
      const matched = channels.find((c) => c.id === initialChannelId);
      if (matched) {
        setActiveCategory(matched.type);
      }
      setActiveChannelId(initialChannelId);
    }
  }, [initialChannelId, channels]);

  useEffect(() => {
    if (activeChannelId) {
      void loadMessages(activeChannelId);
    } else {
      setMessages([]);
    }
  }, [activeChannelId, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;

    const connectSse = async () => {
      const token = getSessionToken();
      const idToken = await getCurrentOwnerFirebaseIdToken();
      if (closed || (!token && !idToken)) return;

      const params = new URLSearchParams();
      if (token) params.set('token', token);
      if (idToken) params.set('idToken', idToken);

      es = new EventSource(`/api/chat/stream?${params.toString()}`);
      es.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data) as {
            type?: string;
            channel?: EnvironmentChatChannel;
            message?: EnvironmentChatMessage;
          };
          if (parsed.type === 'chat:message' && parsed.message && parsed.channel) {
            setChannels((prev) => {
              const exists = prev.some((c) => c.id === parsed.channel!.id);
              if (!exists) return [parsed.channel!, ...prev];
              return prev.map((c) => (c.id === parsed.channel!.id ? parsed.channel! : c));
            });
            setMessages((prev) => {
              if (parsed.message!.channelId !== activeChannelIdRef.current) return prev;
              if (prev.some((m) => m.id === parsed.message!.id)) return prev;
              return [...prev, parsed.message!];
            });
          }
        } catch {
          // ignore malformed keepalive
        }
      };
    };

    void connectSse();
    return () => {
      closed = true;
      es?.close();
    };
  }, [currentUser.id]);

  const categoryChannels = useMemo(
    () => channels.filter((c) => c.type === activeCategory),
    [channels, activeCategory]
  );

  const handleSelectCategory = (cat: ChatChannelType) => {
    setActiveCategory(cat);
    const matches = channels.filter((c) => c.type === cat);
    if (matches.length > 0) {
      const prioritized =
        (workspaceId && matches.find((c) => c.workspaceId === workspaceId)) || matches[0];
      if (!matches.some((c) => c.id === activeChannelId)) {
        setActiveChannelId(prioritized.id);
      }
    } else {
      setActiveChannelId('');
    }
  };

  const activeChannel = channels.find((c) => c.id === activeChannelId) || null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !activeChannelId || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await apiFetch<{
        message: EnvironmentChatMessage;
        channel: EnvironmentChatChannel;
      }>(`/api/chat/channels/${encodeURIComponent(activeChannelId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      setChannels((prev) => prev.map((c) => (c.id === res.channel.id ? res.channel : c)));
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الرسالة.');
    } finally {
      setSending(false);
    }
  };

  const renderCategoryIcon = (cat: ChatChannelType) => {
    if (cat === 'group') return <Users className="w-4 h-4" />;
    if (cat === 'workspace_internal') return <Building2 className="w-4 h-4" />;
    if (cat === 'applicant_direct') return <FilePlus2 className="w-4 h-4" />;
    return <MessageSquare className="w-4 h-4" />;
  };

  return (
    <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl overflow-hidden flex flex-col">
      {/* 4-Tier Chat Category Tabs */}
      {availableCategories.length > 0 && (
        <div className="px-4 py-3 border-b border-[#EAE0D5] bg-[#FAF6EE] flex flex-wrap items-center gap-2">
          {availableCategories.map((cat) => {
            const count = channels.filter((c) => c.type === cat).length;
            const isSelected = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => handleSelectCategory(cat)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[#7A1523] text-white'
                    : 'bg-[#FFFDF9] border border-[#EAE0D5] text-[#755953] hover:text-[#2C1813]'
                }`}
              >
                {renderCategoryIcon(cat)}
                <span>{CATEGORY_META[cat].label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono tabular-nums ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-[#FAF6EE] text-[#A46714]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[520px]">
        {/* Channels List */}
        <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-l border-[#EAE0D5] bg-[#FAF6EE]/60 flex flex-col">
          <div className="px-5 py-4 border-b border-[#EAE0D5] flex items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-[#2C1813] text-sm">
                {CATEGORY_META[activeCategory].label}
              </h3>
              <p className="text-[11px] text-[#755953] mt-0.5">
                {CATEGORY_META[activeCategory].subtitle}
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-[#A46714] font-semibold shrink-0">
              {categoryChannels.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#EAE0D5]">
            {loadingChannels ? (
              <div className="p-5 space-y-3">
                <div className="h-14 rounded-xl bg-[#EAE0D5]/40 animate-pulse" />
                <div className="h-14 rounded-xl bg-[#EAE0D5]/40 animate-pulse" />
              </div>
            ) : categoryChannels.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#755953]">
                لا توجد محادثات في هذا القسم حالياً.
              </div>
            ) : (
              categoryChannels.map((ch) => {
                const isActive = ch.id === activeChannelId;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setActiveChannelId(ch.id)}
                    className={`w-full text-right px-4 py-3.5 transition-colors cursor-pointer flex items-start gap-3 ${
                      isActive
                        ? 'bg-[#FFFDF9] border-r-2 border-r-[#7A1523]'
                        : 'hover:bg-[#FFFDF9]/60'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center ${
                        ch.type === 'group' || ch.type === 'workspace_internal'
                          ? 'bg-[#FBF2D8] text-[#A46714]'
                          : 'bg-[#FDF2F4] text-[#7A1523]'
                      }`}
                    >
                      {renderCategoryIcon(ch.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-sm text-[#2C1813] truncate">
                          {ch.title}
                        </span>
                        <span className="text-[11px] font-mono tabular-nums text-[#755953] shrink-0">
                          {formatArabicTime(ch.lastMessageAt)}
                        </span>
                      </div>
                      <div className="text-xs text-[#755953] mt-0.5 flex items-center gap-1.5">
                        <span>
                          {ch.type === 'group'
                            ? 'قناة جماعية'
                            : ch.type === 'workspace_internal'
                            ? 'فريق خدام الفصل'
                            : ROLE_LABELS[ch.participantRole || ''] || 'محادثة مباشرة'}
                        </span>
                        {ch.className && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{ch.className}</span>
                          </>
                        )}
                      </div>
                      {ch.lastMessage && (
                        <p className="text-xs text-[#755953]/90 truncate mt-1">{ch.lastMessage}</p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Active Thread */}
        <section className="lg:col-span-8 flex flex-col bg-[#FFFDF9]">
          {activeChannel ? (
            <>
              <header className="px-6 py-4 border-b border-[#EAE0D5] flex flex-wrap items-center justify-between gap-3 bg-[#FFFDF9]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-base text-[#2C1813] truncate">
                      {activeChannel.title}
                    </h4>
                  </div>
                  <p className="text-xs text-[#755953] mt-0.5">
                    {activeChannel.type === 'group'
                      ? 'تجمع كافة أمناء الفصول المعتمدين مع صاحب الـ Environment'
                      : activeChannel.type === 'workspace_internal'
                      ? `${activeChannel.churchName || ''} · قناة داخلية خاصة بخدام الفصل`
                      : `${activeChannel.churchName || 'خدمة جديدة'} · ${activeChannel.className || 'محادثة مباشرة'}`}
                  </p>
                </div>

                {currentUser.role === 'environment_owner' &&
                  (activeChannel.type === 'applicant_direct' || activeChannel.participantRole === 'applicant') &&
                  !activeChannel.workspaceId &&
                  onApproveFromChannel && (
                    <button
                      type="button"
                      onClick={() => onApproveFromChannel(activeChannel)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      اعتماد وإنشاء مساحة الخدمة
                    </button>
                  )}

                {activeChannel.workspaceId && activeChannel.type === 'direct' && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#A46714]">
                    <ShieldCheck className="w-4 h-4" />
                    مساحة خدمة مفعّلة
                  </span>
                )}
              </header>

              {error && (
                <div className="mx-6 mt-4 px-4 py-2.5 rounded-xl bg-[#FDF2F4] border border-[#7A1523]/20 text-xs text-[#7A1523]">
                  {error}
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-6 space-y-4 max-h-[420px]">
                {loadingMessages ? (
                  <div className="text-center py-12 text-sm text-[#755953]">جاري تحميل الرسائل...</div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-12 text-sm text-[#755953]">
                    لا توجد رسائل بعد. ابدأ الحوار الآن.
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMine = msg.senderId === currentUser.id;
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isMine ? 'items-start' : 'items-end'}`}
                      >
                        <div
                          className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 border ${
                            msg.isSystem
                              ? 'bg-[#FBF2D8]/60 border-[#D4AF37]/40 text-[#2C1813]'
                              : isMine
                              ? 'bg-[#7A1523] border-[#7A1523] text-white'
                              : 'bg-[#FAF6EE] border-[#EAE0D5] text-[#2C1813]'
                          }`}
                        >
                          <div className="flex items-center gap-2 text-[11px] mb-1 opacity-85">
                            <span className="font-bold">{msg.senderName}</span>
                            <span aria-hidden="true">·</span>
                            <span>{ROLE_LABELS[msg.senderRole] || msg.senderRole}</span>
                            {msg.senderWorkspaceName && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="truncate max-w-[150px]">{msg.senderWorkspaceName}</span>
                              </>
                            )}
                          </div>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                          <div className="mt-1.5 text-[10px] font-mono tabular-nums opacity-75 text-left">
                            {formatArabicTime(msg.createdAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>

              <form
                onSubmit={handleSend}
                className="p-4 border-t border-[#EAE0D5] bg-[#FAF6EE] flex items-center gap-3"
              >
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="اكتب رسالتك هنا..."
                  className="flex-1 bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl px-4 py-2.5 text-sm text-[#2C1813]"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] disabled:opacity-50 text-white text-sm font-bold transition-colors shrink-0 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  إرسال
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center text-[#755953]">
              <Sparkles className="w-10 h-10 text-[#D4AF37] mb-3" />
              <p className="font-bold text-[#2C1813]">اختر قناة محادثة للبدء</p>
              <p className="text-sm mt-1">
                تنقل بين قنوات الفصل والإدارة وأمناء الفصول من التبويبات بالأعلى.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
