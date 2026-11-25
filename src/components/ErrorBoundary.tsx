import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'حدث خطأ غير متوقع أثناء عرض الصفحة.',
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FAF7F2] text-[#2C1813] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl p-8 text-center shadow-sm">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[#FDF2F4] text-[#7A1523] flex items-center justify-center">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-bold mb-2">تعذر تحميل العرض الحالي</h1>
            <p className="text-sm text-[#755953] mb-6 leading-relaxed break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              إعادة تحميل المنصة
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
