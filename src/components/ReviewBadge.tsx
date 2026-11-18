import React from 'react';
import { AlertCircle } from 'lucide-react';
import { TaskItem } from '../types/project';
import { getTaskDataReviewSummary } from '../utils/taskHelpers';

interface ReviewBadgeProps {
  task: Pick<TaskItem, 'status' | 'reviewFlags'>;
  className?: string;
}

/**
 * Displays consolidated data-quality warning badge ("Cần rà soát dữ liệu")
 * strictly for non-status reviewFlags (never duplicates "Thiếu trạng thái").
 */
export const ReviewBadge: React.FC<ReviewBadgeProps> = ({
  task,
  className = '',
}) => {
  const summary = getTaskDataReviewSummary(task);
  if (summary.dataFlags.length === 0) {
    return null;
  }

  const count = summary.dataFlags.length;
  const label =
    count > 1 ? `Cần rà soát dữ liệu (${count})` : 'Cần rà soát dữ liệu';
  const tooltipText = `Cần rà soát dữ liệu: ${summary.dataFlagLabels.join(' · ')}`;

  return (
    <span
      title={tooltipText}
      aria-label={tooltipText}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-[#DEB2AE] bg-[#FAF0EE] text-[#8B322F] text-[11.5px] font-semibold leading-snug whitespace-nowrap shrink-0 ${className}`}
    >
      <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
};
