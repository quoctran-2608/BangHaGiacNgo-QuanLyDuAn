import React from 'react';
import { Folder } from 'lucide-react';
import { getCategoryVisualTheme } from '../utils/taskHelpers';

interface CategoryChipProps {
  categoryId?: string | null;
  categoryName?: string | null;
  color?: string;
  className?: string;
}

export const CategoryChip: React.FC<CategoryChipProps> = ({
  categoryId,
  categoryName,
  color,
  className = '',
}) => {
  const displayName = (categoryName ?? '').trim() || 'Chưa phân hạng mục';
  const theme = getCategoryVisualTheme(categoryId, displayName, color);

  return (
    <span
      style={{
        backgroundColor: theme.softBg,
        color: theme.text,
        borderColor: theme.softBorder,
      }}
      title={`Hạng mục: ${displayName}`}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11.5px] font-semibold leading-snug max-w-[230px] sm:max-w-[280px] ${className}`}
    >
      <Folder
        className="w-3 h-3 shrink-0"
        style={{ color: theme.accent }}
        aria-hidden="true"
      />
      <span className="truncate">{displayName}</span>
    </span>
  );
};
