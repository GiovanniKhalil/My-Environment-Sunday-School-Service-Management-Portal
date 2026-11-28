import React from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import type { WorkspaceStage } from '../types';

interface StageBuilderProps {
  stages: WorkspaceStage[];
  onChange: (stages: WorkspaceStage[]) => void;
  label?: string;
}

const PRESETS: Array<{ label: string; names: string[] }> = [
  { label: 'مرحلة واحدة', names: ['المرحلة الأولى'] },
  { label: 'مرحلتين (أولى وتانية)', names: ['أولى ابتدائي', 'تانية ابتدائي'] },
  { label: '3 مراحل (أولى وتانية وتالتة)', names: ['أولى ابتدائي', 'تانية ابتدائي', 'تالتة ابتدائي'] },
  { label: '4 مراحل', names: ['المرحلة الأولى', 'المرحلة الثانية', 'المرحلة الثالثة', 'المرحلة الرابعة'] },
];

export const StageBuilder: React.FC<StageBuilderProps> = ({
  stages,
  onChange,
  label = 'المراحل الدراسية / الصفوف داخل الفصل',
}) => {
  const applyPreset = (names: string[]) => {
    onChange(
      names.map((name, idx) => ({
        id: `stg_${idx + 1}`,
        name,
      }))
    );
  };

  const handleNameChange = (idx: number, value: string) => {
    const updated = stages.map((stg, i) => (i === idx ? { ...stg, name: value } : stg));
    onChange(updated);
  };

  const handleAddStage = () => {
    const nextIndex = stages.length + 1;
    const uniqueId = `stg_${nextIndex}_${Date.now().toString(36).slice(-3)}`;
    onChange([...stages, { id: uniqueId, name: `المرحلة ${nextIndex}` }]);
  };

  const handleRemoveStage = (idx: number) => {
    if (stages.length <= 1) return;
    onChange(stages.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3 p-4 rounded-2xl bg-[#FAF6EE] border border-[#EAE0D5]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs font-extrabold text-[#2C1813] flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-[#7A1523]" />
          <span>{label}</span>
        </label>
        <span className="text-[11px] font-mono tabular-nums font-bold text-[#A46714]">
          {stages.length} {stages.length === 1 ? 'مرحلة' : stages.length === 2 ? 'مرحلتين' : 'مراحل'}
        </span>
      </div>

      {/* Quick Presets */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((preset) => {
          const isMatch =
            stages.length === preset.names.length &&
            stages.every((s, idx) => s.name.trim() === preset.names[idx]);
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset.names)}
              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-colors cursor-pointer ${
                isMatch
                  ? 'bg-[#7A1523] border-[#7A1523] text-white'
                  : 'bg-[#FFFDF9] border-[#EAE0D5] hover:border-[#A46714] text-[#755953] hover:text-[#2C1813]'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Dynamic Stage Inputs */}
      <div className="space-y-2">
        {stages.map((stg, idx) => (
          <div key={stg.id || idx} className="flex items-center gap-2">
            <span className="w-7 h-9 rounded-xl bg-[#FFFDF9] border border-[#EAE0D5] text-xs font-mono tabular-nums font-extrabold text-[#A46714] flex items-center justify-center shrink-0">
              {idx + 1}
            </span>
            <input
              type="text"
              required
              value={stg.name}
              onChange={(e) => handleNameChange(idx, e.target.value)}
              placeholder={`اسم المرحلة ${idx + 1} (مثال: أولى إعدادي)`}
              className="flex-1 bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl px-3.5 py-2 text-sm font-semibold text-[#2C1813]"
            />
            {stages.length > 1 && (
              <button
                type="button"
                onClick={() => handleRemoveStage(idx)}
                className="p-2 rounded-xl border border-[#EAE0D5] bg-[#FFFDF9] hover:bg-[#FDF2F4] text-[#7A1523] shrink-0 cursor-pointer"
                title="حذف المرحلة"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleAddStage}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FFFDF9] border border-[#D4AF37]/50 hover:border-[#7A1523] text-xs font-bold text-[#7A1523] cursor-pointer"
      >
        <Plus className="w-4 h-4" />
        + إضافة مرحلة
      </button>
    </div>
  );
};
