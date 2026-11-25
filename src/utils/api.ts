import * as XLSX from 'xlsx';
import type { Student } from '../types';

let inMemorySessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  inMemorySessionToken = token;
}

export function getSessionToken(): string | null {
  return inMemorySessionToken;
}

export function clearSessionToken(): void {
  inMemorySessionToken = null;
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (inMemorySessionToken) {
    headers.set('Authorization', `Bearer ${inMemorySessionToken}`);
  }
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || 'حدث خطأ غير متوقع في الاتصال بالخادم.');
  }
  return data as T;
}

export async function compressImageToDataUrl(
  file: File,
  maxWidth = 320,
  quality = 0.78
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('تعذر معالجة الصورة.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('ملف الصورة غير صالح.'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('تعذر قراءة الملف.'));
    reader.readAsDataURL(file);
  });
}

export function buildWhatsAppUrl(phone: string, text: string): string {
  const digits = phone.replace(/\D+/g, '');
  let normalized = digits;
  if (digits.startsWith('01') && digits.length === 11) {
    normalized = `2${digits}`;
  } else if (digits.startsWith('00')) {
    normalized = digits.slice(2);
  }
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

export function formatArabicDate(isoDate: string): string {
  if (!isoDate) return '—';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

export function formatArabicTime(isoDate: string): string {
  if (!isoDate) return '';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function exportAttendanceToExcel(
  students: Student[],
  className: string,
  gradeFilter: string,
  sessionFilter: 'all' | 'mass' | 'sunday_school'
): void {
  const filtered =
    gradeFilter === 'all' ? students : students.filter((s) => s.grade === gradeFilter);

  const rows = filtered.map((s) => {
    const relevant =
      sessionFilter === 'all'
        ? s.attendanceHistory
        : s.attendanceHistory.filter((a) => a.sessionType === sessionFilter);
    const presentCount = relevant.filter((a) => a.status === 'present').length;
    const absentCount = relevant.filter((a) => a.status === 'absent').length;
    return {
      'الاسم الكامل': s.fullName,
      'المرحلة / الصف': s.grade,
      'النوع': s.gender,
      'هاتف ولي الأمر': s.parentPhone || s.phone || '—',
      'إجمالي النقاط': s.points,
      'نسبة الحضور %': `${s.evaluations.attendanceRate}%`,
      'مرات الحضور': presentCount,
      'مرات الغياب': absentCount,
      'اسم المستخدم': s.username,
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 28 },
    { wch: 18 },
    { wch: 10 },
    { wch: 16 },
    { wch: 14 },
    { wch: 15 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'تقرير الحضور');
  const safeName = className.replace(/[^\u0600-\u06FFa-zA-Z0-9_-]/g, '_');
  XLSX.writeFile(wb, `تقرير_${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export interface ImportedStudentRow {
  fullName: string;
  grade: string;
  gender: 'ذكر' | 'أنثى';
  birthDate: string;
  phone: string;
  parentPhone: string;
  address: string;
  username: string;
  tempPassword: string;
}

export async function parseStudentsSpreadsheet(file: File): Promise<ImportedStudentRow[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  return rawRows
    .map((row) => {
      const fullName = String(
        row['الاسم'] || row['الاسم الكامل'] || row['fullName'] || row['Name'] || ''
      ).trim();
      const grade = String(row['المرحلة'] || row['الصف'] || row['grade'] || row['Grade'] || '').trim();
      const genderRaw = String(row['النوع'] || row['gender'] || 'ذكر').trim();
      const gender: 'ذكر' | 'أنثى' = genderRaw.includes('أنث') || genderRaw.toLowerCase() === 'f' ? 'أنثى' : 'ذكر';
      const birthDate = String(row['تاريخ الميلاد'] || row['birthDate'] || '').trim();
      const phone = String(row['الهاتف'] || row['phone'] || '').trim();
      const parentPhone = String(row['هاتف ولي الأمر'] || row['parentPhone'] || phone).trim();
      const address = String(row['العنوان'] || row['address'] || '').trim();
      const username = String(row['اسم المستخدم'] || row['username'] || '').trim();
      const tempPassword = String(row['كلمة المرور'] || row['password'] || '123456').trim();
      return { fullName, grade, gender, birthDate, phone, parentPhone, address, username, tempPassword };
    })
    .filter((r) => r.fullName.length >= 2);
}
