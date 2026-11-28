import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  FilePlus2,
  Lock,
  Megaphone,
  MessageSquare,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCog,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  ChatChannelType,
  EnvironmentChatChannel,
  EnvironmentChatMessage,
  HeadServantSummary,
  SessionUser,
} from '../types';
import { formatArabicTime } from '../utils/api';
import {
  createCustomGroupInFirestore,
  deleteCustomGroupInFirestore,
  sendChatMessageInFirestore,
  subscribeChannelMessages,
  subscribeChatChannels,
  updateCustomGroupInFirestore,
} from '../services/firestoreService';

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
    label: 'المجموعات والإشعارات',
    subtitle: 'قناة الإشعارات العامة والمجموعات المخصصة لأمناء الفصول',
    icon: 'group',
  },
  applicant_direct: {
    label: 'طلبات التأسيس الجديدة',
    subtitle: 'مناقشة طلبات إنشاء الغرف والخدمات الجديدة',
    icon: 'applicant',
  },
};

function isBroadcastChannel(channel: Pick<EnvironmentChatChannel, 'id' | 'isBroadcast'> | null): boolean {
  if (!channel) return false;
  return channel.id === 'global_leaders' || channel.isBroadcast === true;
}

export const UnifiedChatHub: React.FC<UnifiedChatHubProps> = ({
  currentUser,
  workspaceId,
  onApproveFromChannel,
  initialChannelId,
}) => {
  const [channels, setChannels] = useState<EnvironmentChatChannel[]>([]);
  const [headServants, setHeadServants] = useState<HeadServantSummary[]>([]);
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

  // Create Custom Group modal state (Owner only)
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newGroupMemberIds, setNewGroupMemberIds] = useState<string[]>([]);
  const [createSearch, setCreateSearch] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupModalError, setGroupModalError] = useState('');

  // Manage Custom Group modal state (Owner only)
  const [showManageGroup, setShowManageGroup] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const [addMemberId, setAddMemberId] = useState('');
  const [updatingMembers, setUpdatingMembers] = useState(false);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [manageError, setManageError] = useState('');

  const endRef = useRef<HTMLDivElement | null>(null);
  const activeChannelIdRef = useRef<string>(activeChannelId);

  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);

  const isOwner = currentUser.role === 'environment_owner';

  const canViewChannelClient = useCallback(
    (ch: EnvironmentChatChannel): boolean => {
      if (isOwner) return true;
      if (isBroadcastChannel(ch)) return currentUser.role === 'head_servant';
      if (ch.type === 'group') {
        return (
          currentUser.role === 'head_servant' &&
          Array.isArray(ch.memberIds) &&
          ch.memberIds.includes(currentUser.id)
        );
      }
      return true;
    },
    [isOwner, currentUser.id, currentUser.role]
  );

  const visibleChannels = useMemo(
    () => channels.filter(canViewChannelClient),
    [channels, canViewChannelClient]
  );

  const availableCategories = useMemo<ChatChannelType[]>(() => {
    if (isOwner) {
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
  }, [isOwner, currentUser.role, workspaceId]);

  useEffect(() => {
    setLoadingChannels(true);
    setError('');
    const unsub = subscribeChatChannels(
      currentUser,
      workspaceId,
      (rawChannels) => {
        const filtered = rawChannels.filter(canViewChannelClient);
        setChannels(filtered);
        setLoadingChannels(false);

        if (initialChannelId) {
          const target = filtered.find((c) => c.id === initialChannelId);
          if (target && !activeChannelIdRef.current) {
            setActiveCategory(target.type);
            setActiveChannelId(target.id);
            return;
          }
        }

        if (filtered.length > 0) {
          const currentSelected = filtered.find((c) => c.id === activeChannelIdRef.current);
          if (currentSelected) {
            return;
          }
          const preferredCategory =
            workspaceId &&
            filtered.some((c) => c.type === 'workspace_internal' && c.workspaceId === workspaceId)
              ? 'workspace_internal'
              : availableCategories.find((cat) => filtered.some((c) => c.type === cat)) ||
                filtered[0].type;
          setActiveCategory(preferredCategory);
          const preferredChannel =
            filtered.find(
              (c) =>
                c.type === preferredCategory &&
                (!workspaceId || c.workspaceId === workspaceId)
            ) ||
            filtered.find((c) => c.type === preferredCategory) ||
            filtered[0];
          setActiveChannelId(preferredChannel.id);
        } else {
          setActiveChannelId('');
        }
      },
      (summaries) => {
        setHeadServants(summaries);
      },
      (err) => {
        setError(err instanceof Error ? err.message : 'تعذر تحميل قنوات التواصل.');
        setLoadingChannels(false);
      }
    );

    return () => unsub();
  }, [currentUser, workspaceId, initialChannelId, availableCategories, canViewChannelClient]);

  useEffect(() => {
    if (initialChannelId) {
      const matched = visibleChannels.find((c) => c.id === initialChannelId);
      if (matched) {
        setActiveCategory(matched.type);
        setActiveChannelId(initialChannelId);
      }
    }
  }, [initialChannelId, visibleChannels]);

  useEffect(() => {
    if (!activeChannelId) {
      setMessages([]);
      setLoadingMessages(false);
      return;
    }
    setLoadingMessages(true);
    setError('');
    const unsub = subscribeChannelMessages(
      activeChannelId,
      (msgs) => {
        setMessages(msgs);
        setLoadingMessages(false);
      },
      (err) => {
        setError(err instanceof Error ? err.message : 'تعذر تحميل الرسائل.');
        setLoadingMessages(false);
      }
    );
    return () => unsub();
  }, [activeChannelId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const categoryChannels = useMemo(() => {
    const list = visibleChannels.filter((c) => c.type === activeCategory);
    if (activeCategory === 'group') {
      return [...list].sort((a, b) => {
        const aBroad = isBroadcastChannel(a) ? 1 : 0;
        const bBroad = isBroadcastChannel(b) ? 1 : 0;
        if (aBroad !== bBroad) return bBroad - aBroad;
        return (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '');
      });
    }
    return list;
  }, [visibleChannels, activeCategory]);

  const handleSelectCategory = (cat: ChatChannelType) => {
    setActiveCategory(cat);
    const matches = visibleChannels.filter((c) => c.type === cat);
    if (matches.length > 0) {
      const prioritized =
        (cat === 'group' && matches.find((c) => isBroadcastChannel(c))) ||
        (workspaceId && matches.find((c) => c.workspaceId === workspaceId)) ||
        matches[0];
      if (!matches.some((c) => c.id === activeChannelId)) {
        setActiveChannelId(prioritized.id);
      }
    } else {
      setActiveChannelId('');
    }
  };

  const activeChannel = visibleChannels.find((c) => c.id === activeChannelId) || null;
  const activeIsBroadcast = isBroadcastChannel(activeChannel);
  const activeIsCustomGroup = Boolean(
    activeChannel && activeChannel.type === 'group' && !activeIsBroadcast
  );
  const isReadOnlyForCurrentUser = activeIsBroadcast && !isOwner;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !activeChannel || sending || isReadOnlyForCurrentUser) return;
    setSending(true);
    setError('');
    try {
      const ownWsName =
        channels.find((c) => c.workspaceId && c.workspaceId === (workspaceId || currentUser.workspaceId))
          ?.className ||
        currentUser.proposedClassName ||
        '';
      await sendChatMessageInFirestore(activeChannel, text, currentUser, ownWsName);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الرسالة.');
    } finally {
      setSending(false);
    }
  };

  const filteredHeadServantsForCreate = useMemo(() => {
    const q = createSearch.trim().toLowerCase();
    if (!q) return headServants;
    return headServants.filter(
      (hs) =>
        hs.fullName.toLowerCase().includes(q) ||
        hs.className.toLowerCase().includes(q) ||
        hs.churchName.toLowerCase().includes(q) ||
        hs.username.toLowerCase().includes(q)
    );
  }, [headServants, createSearch]);

  const toggleCreateMember = (id: string) => {
    setNewGroupMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = newGroupTitle.trim();
    if (!cleanTitle) {
      setGroupModalError('يرجى إدخال اسم المجموعة.');
      return;
    }
    if (newGroupMemberIds.length === 0) {
      setGroupModalError('يرجى اختيار أمين فصل واحد على الأقل للمجموعة.');
      return;
    }
    setCreatingGroup(true);
    setGroupModalError('');
    try {
      const created = await createCustomGroupInFirestore(
        cleanTitle,
        newGroupMemberIds,
        headServants,
        currentUser
      );
      setActiveCategory('group');
      setActiveChannelId(created.id);
      setShowCreateGroup(false);
      setNewGroupTitle('');
      setNewGroupMemberIds([]);
      setCreateSearch('');
    } catch (err) {
      setGroupModalError(err instanceof Error ? err.message : 'تعذر إنشاء المجموعة.');
    } finally {
      setCreatingGroup(false);
    }
  };

  const openManageModal = (ch: EnvironmentChatChannel) => {
    setRenameDraft(ch.title);
    setManageError('');
    setConfirmDeleteGroup(false);
    const currentSet = new Set(ch.memberIds || []);
    const firstAvailable = headServants.find((hs) => !currentSet.has(hs.id));
    setAddMemberId(firstAvailable?.id || '');
    setShowManageGroup(true);
  };

  const handleRenameGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChannel) return;
    const cleanTitle = renameDraft.trim();
    if (!cleanTitle) {
      setManageError('يرجى كتابة اسم صالح للمجموعة.');
      return;
    }
    setSavingRename(true);
    setManageError('');
    try {
      await updateCustomGroupInFirestore(activeChannel, { title: cleanTitle }, headServants);
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'تعذر تحديث اسم المجموعة.');
    } finally {
      setSavingRename(false);
    }
  };

  const handleUpdateMembers = async (nextMemberIds: string[]) => {
    if (!activeChannel) return;
    setUpdatingMembers(true);
    setManageError('');
    try {
      const updated = await updateCustomGroupInFirestore(
        activeChannel,
        { memberIds: nextMemberIds },
        headServants
      );
      const updatedSet = new Set(updated.memberIds || []);
      const nextAvailable = headServants.find((hs) => !updatedSet.has(hs.id));
      setAddMemberId(nextAvailable?.id || '');
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'تعذر تحديث أعضاء المجموعة.');
    } finally {
      setUpdatingMembers(false);
    }
  };

  const handleAddMemberToGroup = () => {
    if (!activeChannel || !addMemberId || updatingMembers) return;
    const current = Array.isArray(activeChannel.memberIds) ? activeChannel.memberIds : [];
    if (current.includes(addMemberId)) return;
    void handleUpdateMembers([...current, addMemberId]);
  };

  const handleRemoveMemberFromGroup = (memberId: string) => {
    if (!activeChannel || updatingMembers) return;
    const current = Array.isArray(activeChannel.memberIds) ? activeChannel.memberIds : [];
    void handleUpdateMembers(current.filter((id) => id !== memberId));
  };

  const handleDeleteCustomGroup = async () => {
    if (!activeChannel || deletingGroup) return;
    setDeletingGroup(true);
    setManageError('');
    try {
      const deletedId = activeChannel.id;
      await deleteCustomGroupInFirestore(activeChannel, headServants);
      const remaining = visibleChannels.filter((c) => c.id !== deletedId);
      const fallback = remaining.find((c) => c.type === 'group') || remaining[0] || null;
      setActiveChannelId(fallback?.id || '');
      setShowManageGroup(false);
      setConfirmDeleteGroup(false);
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'تعذر حذف المجموعة.');
    } finally {
      setDeletingGroup(false);
    }
  };

  const activeGroupMembers = useMemo(() => {
    if (!activeChannel || !Array.isArray(activeChannel.memberIds)) return [];
    const byId = new Map(headServants.map((hs) => [hs.id, hs]));
    return activeChannel.memberIds.map((id) => {
      const found = byId.get(id);
      if (found) return found;
      return {
        id,
        fullName: 'أمين فصل معتمد',
        username: id,
        phone: '',
        workspaceId: '',
        className: 'فصل خدمة',
        churchName: '',
        status: 'active' as const,
      };
    });
  }, [activeChannel, headServants]);

  const nonMemberHeadServants = useMemo(() => {
    const memberSet = new Set(activeChannel?.memberIds || []);
    return headServants.filter((hs) => !memberSet.has(hs.id));
  }, [headServants, activeChannel]);

  const renderCategoryIcon = (cat: ChatChannelType) => {
    if (cat === 'group') return <Users className="w-4 h-4" />;
    if (cat === 'workspace_internal') return <Building2 className="w-4 h-4" />;
    if (cat === 'applicant_direct') return <FilePlus2 className="w-4 h-4" />;
    return <MessageSquare className="w-4 h-4" />;
  };

  return (
    <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl overflow-hidden flex flex-col">
      {/* 4-Tier Chat Category Tabs + Owner Create Group CTA */}
      {availableCategories.length > 0 && (
        <div className="px-4 py-3 border-b border-[#EAE0D5] bg-[#FAF6EE] flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {availableCategories.map((cat) => {
              const count = visibleChannels.filter((c) => c.type === cat).length;
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

          {isOwner && (
            <button
              type="button"
              onClick={() => {
                setGroupModalError('');
                setNewGroupTitle('');
                setNewGroupMemberIds([]);
                setCreateSearch('');
                setShowCreateGroup(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              إنشاء مجموعة جديدة
            </button>
          )}
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
                const chIsBroadcast = isBroadcastChannel(ch);
                const chIsCustomGroup = ch.type === 'group' && !chIsBroadcast;
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
                        chIsBroadcast
                          ? 'bg-[#FBF2D8] text-[#7A1523]'
                          : ch.type === 'group' || ch.type === 'workspace_internal'
                          ? 'bg-[#FBF2D8] text-[#A46714]'
                          : 'bg-[#FDF2F4] text-[#7A1523]'
                      }`}
                    >
                      {chIsBroadcast ? (
                        <Megaphone className="w-4 h-4" />
                      ) : (
                        renderCategoryIcon(ch.type)
                      )}
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
                          {chIsBroadcast
                            ? isOwner
                              ? 'قناة إشعارات عامة'
                              : 'إشعارات عامة · قراءة فقط'
                            : chIsCustomGroup
                            ? `مجموعة مخصصة · ${ch.memberIds?.length || 0} أعضاء`
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
                    {activeIsBroadcast && (
                      <Megaphone className="w-4 h-4 text-[#7A1523] shrink-0" />
                    )}
                    <h4 className="font-bold text-base text-[#2C1813] truncate">
                      {activeChannel.title}
                    </h4>
                  </div>
                  <p className="text-xs text-[#755953] mt-0.5">
                    {activeIsBroadcast
                      ? 'قناة الإشعارات والتنبيهات العامة لجميع أمناء الفصول المعتمدين'
                      : activeIsCustomGroup
                      ? `مجموعة مخصصة · ${activeChannel.memberIds?.length || 0} من أمناء الفصول`
                      : activeChannel.type === 'workspace_internal'
                      ? `${activeChannel.churchName || ''} · قناة داخلية خاصة بخدام الفصل`
                      : `${activeChannel.churchName || 'خدمة جديدة'} · ${activeChannel.className || 'محادثة مباشرة'}`}
                  </p>
                </div>

                {activeIsBroadcast && !isOwner && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#A46714] shrink-0">
                    <Lock className="w-3.5 h-3.5" />
                    للقراءة فقط
                  </span>
                )}

                {isOwner && activeIsCustomGroup && (
                  <button
                    type="button"
                    onClick={() => openManageModal(activeChannel)}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#FAF6EE] hover:bg-[#FBF2D8] border border-[#EAE0D5] text-[#2C1813] text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <UserCog className="w-4 h-4 text-[#7A1523]" />
                    إدارة الأعضاء ({activeChannel.memberIds?.length || 0})
                  </button>
                )}

                {isOwner &&
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
                    لا توجد رسائل بعد. {isReadOnlyForCurrentUser ? 'ستظهر هنا تنبيهات إدارة المنصة.' : 'ابدأ الحوار الآن.'}
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

              {isReadOnlyForCurrentUser ? (
                <div className="p-4 border-t border-[#EAE0D5] bg-[#FBF2D8]/65 flex items-center justify-center gap-2.5 text-center">
                  <Lock className="w-4 h-4 text-[#A46714] shrink-0" />
                  <p className="text-xs sm:text-sm font-bold text-[#2C1813]">
                    هذه القناة مخصصة لإشعارات وتنبيهات إدارة المنصة فقط
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={handleSend}
                  className="p-4 border-t border-[#EAE0D5] bg-[#FAF6EE] flex items-center gap-3"
                >
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={
                      activeIsBroadcast
                        ? 'اكتب إشعاراً أو تنبيهاً عاماً لجميع أمناء الفصول...'
                        : 'اكتب رسالتك هنا...'
                    }
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
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center text-[#755953]">
              <Sparkles className="w-10 h-10 text-[#D4AF37] mb-3" />
              <p className="font-bold text-[#2C1813]">اختر قناة محادثة للبدء</p>
              <p className="text-sm mt-1">
                تنقل بين قنوات الفصل والإدارة والمجموعات من التبويبات بالأعلى.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Create Custom Group Modal (Environment Owner Only) */}
      {showCreateGroup && isOwner && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-[#EAE0D5] bg-[#FAF6EE] flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-base text-[#2C1813]">إنشاء مجموعة مخصصة جديدة</h3>
                <p className="text-xs text-[#755953] mt-0.5">
                  اختر اسم المجموعة وأمناء الفصول المشاركين فيها بخصوصية تامة.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateGroup(false)}
                className="w-8 h-8 rounded-xl bg-[#FFFDF9] border border-[#EAE0D5] flex items-center justify-center text-[#755953] hover:text-[#2C1813] cursor-pointer"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="flex-1 overflow-y-auto p-6 space-y-5">
              {groupModalError && (
                <div className="px-4 py-2.5 rounded-xl bg-[#FDF2F4] border border-[#7A1523]/25 text-xs font-semibold text-[#7A1523]">
                  {groupModalError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-[#2C1813] mb-1.5">
                  اسم المجموعة
                </label>
                <input
                  type="text"
                  value={newGroupTitle}
                  onChange={(e) => setNewGroupTitle(e.target.value)}
                  placeholder="مثال: اجتماع أمناء مرحلة ابتدائي، مجموعة تنسيق المؤتمر"
                  maxLength={140}
                  className="w-full bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl px-4 py-2.5 text-sm text-[#2C1813]"
                />
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <label className="text-xs font-bold text-[#2C1813]">
                    تحديد أمناء الفصول ({newGroupMemberIds.length} من {headServants.length})
                  </label>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setNewGroupMemberIds(headServants.map((h) => h.id))}
                      className="text-[#7A1523] font-bold hover:underline cursor-pointer"
                    >
                      تحديد الكل
                    </button>
                    <span className="text-[#EAE0D5]">|</span>
                    <button
                      type="button"
                      onClick={() => setNewGroupMemberIds([])}
                      className="text-[#755953] font-semibold hover:underline cursor-pointer"
                    >
                      إلغاء التحديد
                    </button>
                  </div>
                </div>

                <div className="relative mb-3">
                  <Search className="w-4 h-4 text-[#755953] absolute right-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={createSearch}
                    onChange={(e) => setCreateSearch(e.target.value)}
                    placeholder="ابحث باسم أمين الفصل أو الكنيسة أو اسم الفصل..."
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl pr-10 pl-4 py-2 text-xs text-[#2C1813]"
                  />
                </div>

                <div className="border border-[#EAE0D5] rounded-2xl divide-y divide-[#EAE0D5] max-h-64 overflow-y-auto bg-[#FFFDF9]">
                  {headServants.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#755953]">
                      لا يوجد أمناء فصول نشطون حالياً. قم بإنشاء مساحة خدمة أولاً.
                    </div>
                  ) : filteredHeadServantsForCreate.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#755953]">
                      لا توجد نتائج مطابقة للبحث.
                    </div>
                  ) : (
                    filteredHeadServantsForCreate.map((hs) => {
                      const checked = newGroupMemberIds.includes(hs.id);
                      return (
                        <button
                          key={hs.id}
                          type="button"
                          onClick={() => toggleCreateMember(hs.id)}
                          className={`w-full text-right px-4 py-3 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                            checked ? 'bg-[#FDF2F4]/60' : 'hover:bg-[#FAF6EE]'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#2C1813] truncate">{hs.fullName}</p>
                            <p className="text-xs text-[#755953] truncate mt-0.5">
                              {hs.className} · {hs.churchName}
                            </p>
                          </div>
                          <div
                            className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                              checked
                                ? 'bg-[#7A1523] border-[#7A1523] text-white'
                                : 'bg-[#FFFDF9] border-[#EAE0D5]'
                            }`}
                          >
                            {checked && <Check className="w-3.5 h-3.5" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowCreateGroup(false)}
                  className="px-4 py-2.5 rounded-xl bg-[#FAF6EE] border border-[#EAE0D5] text-xs font-bold text-[#755953] hover:text-[#2C1813] cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={creatingGroup || !newGroupTitle.trim() || newGroupMemberIds.length === 0}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  {creatingGroup ? 'جاري الإنشاء...' : 'إنشاء المجموعة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Group Members, Rename & Delete Modal (Environment Owner Only) */}
      {showManageGroup && isOwner && activeChannel && activeIsCustomGroup && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-[#EAE0D5] bg-[#FAF6EE] flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-base text-[#2C1813]">إدارة أعضاء المجموعة</h3>
                <p className="text-xs text-[#755953] mt-0.5 truncate max-w-md">
                  {activeChannel.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowManageGroup(false)}
                className="w-8 h-8 rounded-xl bg-[#FFFDF9] border border-[#EAE0D5] flex items-center justify-center text-[#755953] hover:text-[#2C1813] cursor-pointer"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {manageError && (
                <div className="px-4 py-2.5 rounded-xl bg-[#FDF2F4] border border-[#7A1523]/25 text-xs font-semibold text-[#7A1523]">
                  {manageError}
                </div>
              )}

              {/* Rename Group */}
              <form onSubmit={handleRenameGroup} className="space-y-2">
                <label className="block text-xs font-bold text-[#2C1813]">تعديل اسم المجموعة</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    maxLength={140}
                    className="flex-1 bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl px-3.5 py-2 text-sm text-[#2C1813]"
                  />
                  <button
                    type="submit"
                    disabled={savingRename || !renameDraft.trim() || renameDraft.trim() === activeChannel.title}
                    className="px-4 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] disabled:opacity-50 text-white text-xs font-bold transition-colors shrink-0 cursor-pointer"
                  >
                    {savingRename ? 'جاري الحفظ...' : 'حفظ الاسم'}
                  </button>
                </div>
              </form>

              {/* Add Head Servant */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#2C1813]">إضافة أمين فصل</label>
                {nonMemberHeadServants.length === 0 ? (
                  <p className="text-xs text-[#755953] bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-4 py-2.5">
                    جميع أمناء الفصول المعتمدين مضافون حالياً في هذه المجموعة.
                  </p>
                ) : (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <select
                      value={addMemberId}
                      onChange={(e) => setAddMemberId(e.target.value)}
                      className="flex-1 bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl px-3.5 py-2 text-xs text-[#2C1813]"
                    >
                      {nonMemberHeadServants.map((hs) => (
                        <option key={hs.id} value={hs.id}>
                          {hs.fullName} — {hs.className} ({hs.churchName})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAddMemberToGroup}
                      disabled={updatingMembers || !addMemberId}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#FBF2D8] hover:bg-[#D4AF37]/25 border border-[#D4AF37]/40 text-[#2C1813] text-xs font-bold transition-colors shrink-0 cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4 text-[#A46714]" />
                      إضافة للمجموعة
                    </button>
                  </div>
                )}
              </div>

              {/* Current Members List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#2C1813]">
                    الأعضاء الحاليون ({activeGroupMembers.length})
                  </span>
                </div>
                <div className="border border-[#EAE0D5] rounded-2xl divide-y divide-[#EAE0D5] max-h-60 overflow-y-auto bg-[#FFFDF9]">
                  {activeGroupMembers.length === 0 ? (
                    <div className="p-5 text-center text-xs text-[#755953]">
                      لا يوجد أعضاء في المجموعة حالياً. يمكنك إضافة أمين فصل من القائمة أعلاه.
                    </div>
                  ) : (
                    activeGroupMembers.map((member) => (
                      <div
                        key={member.id}
                        className="px-4 py-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[#2C1813] truncate">
                            {member.fullName}
                          </p>
                          <p className="text-xs text-[#755953] truncate mt-0.5">
                            {member.className}
                            {member.churchName ? ` · ${member.churchName}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveMemberFromGroup(member.id)}
                          disabled={updatingMembers}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FDF2F4] hover:bg-[#7A1523] text-[#7A1523] hover:text-white border border-[#7A1523]/20 text-xs font-bold transition-colors shrink-0 cursor-pointer"
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                          حذف من المجموعة
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Delete Custom Group */}
              <div className="pt-4 border-t border-[#EAE0D5] flex flex-wrap items-center justify-between gap-3">
                {!confirmDeleteGroup ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteGroup(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-[#7A1523] hover:bg-[#FDF2F4] border border-[#7A1523]/25 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    حذف المجموعة
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-[#7A1523]">
                      تأكيد حذف المجموعة وجميع رسائلها نهائياً؟
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleDeleteCustomGroup()}
                      disabled={deletingGroup}
                      className="px-3.5 py-1.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
                    >
                      {deletingGroup ? 'جاري الحذف...' : 'نعم، احذف المجموعة'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteGroup(false)}
                      className="px-3 py-1.5 rounded-xl bg-[#FAF6EE] border border-[#EAE0D5] text-xs font-bold text-[#755953] cursor-pointer"
                    >
                      تراجع
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowManageGroup(false)}
                  className="px-4 py-2 rounded-xl bg-[#FAF6EE] border border-[#EAE0D5] text-xs font-bold text-[#2C1813] cursor-pointer ms-auto"
                >
                  تم
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
