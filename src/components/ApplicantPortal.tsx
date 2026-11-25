import React from 'react';
import { Church, Clock, LogOut, MessageSquare, Sparkles } from 'lucide-react';
import type { SessionUser } from '../types';
import { UnifiedChatHub } from './UnifiedChatHub';

interface ApplicantPortalProps {
  user: SessionUser;
  onLogout: () => void;
}

export const ApplicantPortal: React.FC<ApplicantPortalProps> = ({ user, onLogout }) => {
  const statusLabel =
    user.status === 'approved'
      ? 'تمت الموافقة وتفعيل المساحة'
      : user.status === 'rejected'
      ? 'معتذر عنه حالياً'
      : 'قيد المراجعة والتنسيق مع صاحب الـ Environment';

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#2C1813]">
      <header className="sticky top-0 z-30 bg-[#FFFDF9]/95 backdrop-blur-xs border-b border-[#EAE0D5]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img
              src="/src/assets/images/coptic_platform_emblem_1795619749170.jpg"
              alt="شعار المنصة"
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-xl object-cover border border-[#EAE0D5]"
            />
            <span className="font-extrabold text-base text-[#2C1813] whitespace-nowrap">
              بوابة طلب خدمة جديد
            </span>
          </div>

          <div className="text-xs text-[#755953] hidden sm:block">
            أهلاً {user.fullName} · {user.proposedChurchName || 'طلب خدمة'}
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#EAE0D5] hover:bg-[#FAF6EE] text-xs font-bold text-[#7A1523] cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            تسجيل الخروج
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-[#A46714]">
              <Clock className="w-4 h-4" />
              <span>{statusLabel}</span>
            </div>
            <h1 className="text-2xl font-black text-[#2C1813]">
              {user.proposedClassName || 'مشروع خدمة مدارس أحد جديدة'}
            </h1>
            <p className="text-sm text-[#755953] flex items-center gap-2">
              <Church className="w-4 h-4 text-[#7A1523]" />
              <span>{user.proposedChurchName}</span>
              <span aria-hidden="true">·</span>
              <span>{user.proposedStageConfig || 'مراحل مخصصة'}</span>
            </p>
            {user.serviceVision && (
              <p className="text-sm text-[#2C1813]/85 pt-2 max-w-2xl leading-relaxed">
                {user.serviceVision}
              </p>
            )}
          </div>

          <div className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-2xl p-5 min-w-[260px]">
            <div className="flex items-center gap-2 text-xs font-bold text-[#7A1523] mb-2">
              <Sparkles className="w-4 h-4" />
              <span>الخطوة التالية</span>
            </div>
            <p className="text-xs text-[#755953] leading-relaxed">
              تواصل مباشرة عبر الشات أدناه مع صاحب الـ Environment لمناقشة احتياجات الفصل وتأكيد إطلاقه. فور الاعتماد سيتحول حسابك تلقائياً إلى «أمين فصل».
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#7A1523]" />
            <h2 className="text-lg font-extrabold text-[#2C1813]">
              المحادثة المباشرة مع صاحب الـ Environment
            </h2>
          </div>
          <UnifiedChatHub currentUser={user} initialChannelId={`direct_${user.id}`} />
        </section>
      </main>
    </div>
  );
};
