import * as React from 'react';

import { cn } from '@/lib/utils';

/** Bảng dày đặc (MASTER 5.5): khung cuộn duy nhất, tiêu đề dính, hover chỉ đổi nền. */
function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="data-table-scroll">
      <table data-slot="table" className={cn('data-table', className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={className} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={className} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={className} {...props} />;
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return <th data-slot="table-head" className={className} {...props} />;
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={className} {...props} />;
}

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell };
