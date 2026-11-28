export type UserRole =
  | 'environment_owner'
  | 'applicant'
  | 'head_servant'
  | 'assistant_head'
  | 'servant'
  | 'student';

export type WorkspaceStatus = 'active' | 'suspended';
export type AccountStatus = 'active' | 'pending' | 'approved' | 'rejected' | 'suspended';
export type Gender = 'ذكر' | 'أنثى';
export type VisitationStatus = 'pending' | 'called' | 'visited' | 'no_answer' | 'special_care';
export type AnnouncementTarget = 'all' | 'students_only' | 'servants_only';

export interface WorkspaceStage {
  id: string;
  name: string;
}

export interface Workspace {
  id: string;
  churchName: string;
  className: string;
  stageConfig: string;
  grades: string[];
  stages?: WorkspaceStage[];
  logoUrl: string;
  verse: string;
  status: WorkspaceStatus;
  headServantId: string;
  headServantName: string;
  ownerUid: string;
  studentCount: number;
  servantCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalUser {
  id: string;
  username: string;
  role: UserRole;
  workspaceId: string;
  fullName: string;
  phone: string;
  email?: string;
  status: AccountStatus;
  mustChangePassword: boolean;
  linkedProfileId: string;
  proposedChurchName?: string;
  proposedClassName?: string;
  proposedStageConfig?: string;
  serviceVision?: string;
  approvedWorkspaceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionUser {
  id: string;
  username: string;
  role: UserRole;
  workspaceId: string;
  fullName: string;
  phone: string;
  email?: string;
  status: AccountStatus;
  mustChangePassword: boolean;
  linkedProfileId: string;
  proposedChurchName?: string;
  proposedClassName?: string;
  proposedStageConfig?: string;
  serviceVision?: string;
  approvedWorkspaceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentEvaluations {
  memoryVerse: number;
  bibleQuiz: number;
  behavior: number;
  attendanceRate: number;
}

export interface AttendanceRecord {
  date: string;
  sessionType: 'mass' | 'sunday_school';
  status: 'present' | 'absent';
  recordedBy: string;
}

export interface PointsHistoryEntry {
  id: string;
  amount: number;
  reason: string;
  date: string;
  recordedBy: string;
}

export interface Student {
  id: string;
  workspaceId: string;
  fullName: string;
  grade: string;
  gender: Gender;
  birthDate: string;
  phone: string;
  parentPhone: string;
  address: string;
  avatarUrl: string;
  points: number;
  badges: string[];
  evaluations: StudentEvaluations;
  attendanceHistory: AttendanceRecord[];
  pointsHistory: PointsHistoryEntry[];
  username: string;
  createdAt: string;
  updatedAt: string;
}

export interface Servant {
  id: string;
  workspaceId: string;
  fullName: string;
  role: 'head_servant' | 'assistant_head' | 'servant';
  phone: string;
  assignedGrade: string;
  gender: Gender;
  avatarUrl: string;
  username: string;
  bio: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceAccount {
  id: string;
  workspaceId: string;
  username: string;
  role: 'head_servant' | 'assistant_head' | 'servant' | 'student';
  fullName: string;
  phone: string;
  linkedProfileId: string;
  mustChangePassword: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceSegments {
  openingPrayer: boolean;
  hymns: boolean;
  coptic: boolean;
  rites: boolean;
  behavior: boolean;
  weeklyReadings: boolean;
  visitationReview: boolean;
}

export interface ServiceSegmentAssignment {
  enabled: boolean;
  primaryServantId: string;
  primaryServantName: string;
  backupServantId: string;
  backupServantName: string;
}

export type ServiceSegmentDetailsMap = Record<keyof ServiceSegments, ServiceSegmentAssignment>;

export interface StageLessonPlan {
  stageId: string;
  stageName: string;
  lessonTitle: string;
  memoryVerse: string;
  primaryTeacherId: string;
  primaryTeacherName: string;
  customPrimaryTeacherName?: string;
  backupTeacherId: string;
  backupTeacherName: string;
}

export interface MonthlySchedule {
  id: string;
  workspaceId: string;
  date: string;
  dateLabel?: string;
  grade: string;
  lessonTitle: string;
  memoryVerse: string;
  primaryTeacherId: string;
  primaryTeacherName: string;
  backupTeacherId: string;
  backupTeacherName: string;
  stageLessons?: StageLessonPlan[];
  segments: ServiceSegments;
  segmentDetails?: ServiceSegmentDetailsMap;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface VisitationRecord {
  id: string;
  workspaceId: string;
  studentId: string;
  studentName: string;
  studentGrade: string;
  studentPhone: string;
  parentPhone: string;
  servantId: string;
  servantName: string;
  status: VisitationStatus;
  weekLabel: string;
  notes: string;
  lastUpdatedAt: string;
}

export interface Announcement {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  target: AnnouncementTarget;
  isUrgent: boolean;
  authorName: string;
  authorRole: string;
  createdAt: string;
}

export interface ChangeRequest {
  id: string;
  workspaceId: string;
  studentId: string;
  studentName: string;
  requestedByUsername: string;
  field: string;
  oldValue: string;
  newValue: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface ServantLog {
  id: string;
  workspaceId: string;
  servantId: string;
  servantName: string;
  action: string;
  details: string;
  createdAt: string;
}

export type ChatChannelType = 'group' | 'direct' | 'workspace_internal' | 'applicant_direct';

export interface EnvironmentChatChannel {
  id: string;
  type: ChatChannelType;
  title: string;
  participantUserId?: string;
  participantName?: string;
  participantRole?: UserRole;
  workspaceId?: string;
  churchName?: string;
  className?: string;
  lastMessage: string;
  lastMessageAt: string;
}

export interface EnvironmentChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderRole: UserRole;
  senderWorkspaceName?: string;
  text: string;
  createdAt: string;
  isSystem?: boolean;
}

export interface WorkspaceBundle {
  workspace: Workspace;
  students: Student[];
  servants: Servant[];
  accounts: WorkspaceAccount[];
  monthlySchedules: MonthlySchedule[];
  visitationSchedules: VisitationRecord[];
  announcements: Announcement[];
  changeRequests: ChangeRequest[];
  servantLogs: ServantLog[];
}
