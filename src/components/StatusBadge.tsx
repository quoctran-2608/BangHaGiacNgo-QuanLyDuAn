import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  PauseCircle,
  PlayCircle,
} from 'lucide-react';
import { TaskStatus } from '../types/project';
import { getStatusMeta } from '../utils/taskHelpers';

interface StatusBadgeProps {
  status: TaskStatus | null;
  compact?: boolean;
  soft?: boolean;
  className?: string;
}

function getStatusIcon(
  status: TaskStatus | null
): React.ComponentType<{ className?: string }> {
  switch (status) {
    case 'Đang làm':
      return PlayCircle;
    case 'Chờ duyệt':
      return Clock3;
    case 'Tạm dừng':
      return PauseCircle;
    case 'Hoàn thành':
      return CheckCircle2;
    case 'Chưa bắt đầu':
      return CircleDashed;
    default:
      return AlertTriangle;
  }
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  compact = false,
  soft = false,
  className = '',
}) => {
  const meta = getStatusMeta(status);
  const Icon = getStatusIcon(status);
  const isUnsetWarning = status === null;

  const badgeStyle: React.CSSProperties = soft
    ? {
        backgroundColor: isUnsetWarning
          ? '#FFF8E7'
          : `color-mix(in srgb, ${meta.bg} 78%, #FFFDFC)`,
        color: meta.text,
        borderColor: isUnsetWarning
          ? '#D9A84E'
          : `color-mix(in srgb, ${meta.border} 65%, transparent)`,
      }
    : {
        backgroundColor: meta.bg,
        color: meta.text,
        borderColor: meta.border,
      };

  return (
    <span
      style={badgeStyle}
      title={
        isUnsetWarning
          ? 'Cảnh báo: Công việc chưa có trạng thái tiến độ'
          : `Trạng thái: ${meta.label}`
      }
      className={`inline-flex items-center justify-center gap-1.5 font-semibold border whitespace-nowrap shrink-0 leading-none tracking-[0.005em] ${
        isUnsetWarning ? 'border-dashed' : ''
      } ${soft ? 'rounded-lg' : 'rounded-md'} ${
        compact
          ? soft
            ? 'px-2.5 h-[27px] text-[11.5px]'
            : 'px-2 h-[26px] text-[11px]'
          : 'px-3 h-[30px] text-xs'
      } ${className}`}
    >
      <Icon
        className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0`}
        aria-hidden="true"
      />
      <span>{meta.label}</span>
    </span>
  );
};
