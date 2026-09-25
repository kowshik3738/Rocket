import { doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';

import { db } from '@/lib/firebase';

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'inappropriate_content',
  'impersonation',
  'scam',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam',
  harassment: 'Harassment or bullying',
  inappropriate_content: 'Inappropriate content',
  impersonation: 'Impersonation',
  scam: 'Scam or fraud',
  other: 'Other',
};

export type UserReport = {
  reporterUid: string;
  reportedUid: string;
  reason: ReportReason;
  details?: string;
  createdAt: Timestamp | null;
};

export type ReportUserParams = {
  reporterUid: string;
  reportedUid: string;
  reason: ReportReason;
  details?: string;
};

export function reportId(reporterUid: string, reportedUid: string): string {
  return `${reporterUid}_${reportedUid}`;
}

export async function reportUser(params: ReportUserParams): Promise<void> {
  const { reporterUid, reportedUid, reason, details } = params;

  if (!reporterUid || !reportedUid) {
    throw new Error('Both reporter and reported user IDs are required.');
  }

  if (reporterUid === reportedUid) {
    throw new Error('You cannot report yourself.');
  }

  if (!REPORT_REASONS.includes(reason)) {
    throw new Error('Please select a valid reason for reporting.');
  }

  const cleanDetails = (details ?? '').trim();
  if (cleanDetails.length > 500) {
    throw new Error('Report details must be 500 characters or fewer.');
  }

  const id = reportId(reporterUid, reportedUid);
  const reportRef = doc(db, 'userReports', id);

  const payload: Record<string, unknown> = {
    reporterUid,
    reportedUid,
    reason,
    createdAt: serverTimestamp(),
  };

  if (cleanDetails.length > 0) {
    payload.details = cleanDetails;
  }

  try {
    await setDoc(reportRef, payload);
  } catch (error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: string }).code)
      : '';
    if (code === 'permission-denied') {
      throw new Error('You have already submitted a report for this user.');
    }
    throw new Error('Could not submit report. Check your connection and try again.');
  }
}
