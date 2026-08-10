/**
 * CALENDAR renderer — renders Dataview CALENDAR query results
 * as a CSS Grid calendar layout with dot indicators.
 */

interface SerializedQueryResult {
  data: Record<string, any>[];
  columns?: { field: string; alias: string }[];
  totalCount: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function renderCalendar(container: HTMLElement, result: SerializedQueryResult): void {
  const { data, columns } = result;

  if (data.length === 0) {
    container.innerHTML = '<div class="dataview-empty">No data for calendar.</div>';
    return;
  }

  // Get the date field (first column or file.cday)
  const dateField = columns && columns.length > 0 ? columns[0].field : 'file.cday';

  // Group pages by date
  const dateMap = new Map<string, Record<string, any>[]>();

  for (const row of data) {
    const dateVal = getFieldValue(row, dateField);
    const dateStr = extractDateString(dateVal);

    if (dateStr) {
      if (!dateMap.has(dateStr)) {
        dateMap.set(dateStr, []);
      }
      dateMap.get(dateStr)!.push(row);
    }
  }

  // Determine the date range
  const dates = [...dateMap.keys()].sort();
  if (dates.length === 0) {
    container.innerHTML = '<div class="dataview-empty">No valid dates found.</div>';
    return;
  }

  const firstDate = new Date(dates[0] + 'T00:00:00');
  const lastDate = new Date(dates[dates.length - 1] + 'T00:00:00');

  // Generate all months in range
  const months = getMonthsInRange(firstDate, lastDate);

  let html = '<div class="dataview-calendar-container">';

  for (const month of months) {
    html += renderMonth(month.year, month.month, dateMap, firstDate, lastDate);
  }

  html += `<div class="dataview-result-count">${result.totalCount} result(s)</div>`;
  html += '</div>';

  container.innerHTML = html;
}

function renderMonth(
  year: number,
  month: number,
  dateMap: Map<string, Record<string, any>[]>,
  rangeStart: Date,
  rangeEnd: Date
): string {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDayOfWeek = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  let html = '<div class="dataview-calendar-month">';
  html += `<h4 class="dataview-calendar-month-title">${MONTH_NAMES[month]} ${year}</h4>`;
  html += '<div class="dataview-calendar-grid">';

  // Day headers
  for (const dayName of DAY_NAMES) {
    html += `<div class="dataview-calendar-day-header">${dayName}</div>`;
  }

  // Empty cells before the first day
  for (let i = 0; i < startDayOfWeek; i++) {
    html += '<div class="dataview-calendar-day dataview-calendar-day-empty"></div>';
  }

  // Day cells
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateStr = formatDateKey(date);
    const entries = dateMap.get(dateStr) || [];

    let classes = 'dataview-calendar-day';

    // Check if within range
    if (date < rangeStart || date > rangeEnd) {
      classes += ' dataview-calendar-day-outside-range';
    }

    // Check if today
    if (date.getTime() === today.getTime()) {
      classes += ' dataview-calendar-day-today';
    }

    // Has entries?
    if (entries.length > 0) {
      classes += ' dataview-calendar-day-has-entries';
    }

    html += `<div class="${classes}">`;
    html += `<span class="dataview-calendar-day-number">${day}</span>`;

    if (entries.length > 0) {
      html += '<div class="dataview-calendar-dots">';
      const maxDots = Math.min(entries.length, 5);
      for (let i = 0; i < maxDots; i++) {
        const entry = entries[i];
        const fileName = entry._page?.file?.name || entry.file?.name || '';
        html += `<span class="dataview-calendar-dot" title="${escapeHtml(fileName)}"></span>`;
      }
      if (entries.length > 5) {
        html += `<span class="dataview-calendar-more">+${entries.length - 5}</span>`;
      }
      html += '</div>';
    }

    html += '</div>';
  }

  html += '</div></div>';
  return html;
}

// ─── Helpers ──────────────────────────────────────────────────────

function getFieldValue(row: Record<string, any>, fieldPath: string): any {
  const parts = fieldPath.split('.');
  let current = row;

  for (const part of parts) {
    if (current === null || current === undefined) return null;
    if (typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return null;
    }
  }

  return current;
}

function extractDateString(value: any): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    // Try YYYY-MM-DD
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    return null;
  }

  if (value.type === 'date') {
    // SDate values are `YYYY-MM-DD HH:mm:ss` (space separator, not 'T')
    const m = String(value.value || '').match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }

  return null;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getMonthsInRange(start: Date, end: Date): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  const current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= end) {
    months.push({ year: current.getFullYear(), month: current.getMonth() });
    current.setMonth(current.getMonth() + 1);
  }

  return months;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
