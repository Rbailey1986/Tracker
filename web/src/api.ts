export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: any,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const fields = json?.details?.fields as Record<string, string> | undefined;
    const msg = fields ? Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('; ') : json?.error ?? res.statusText;
    throw new ApiError(res.status, msg, json);
  }
  return json as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

// ---------- types returned by the server ----------

export type TaskStatus = 'not_started' | 'in_progress' | 'blocked' | 'done' | 'on_hold';
export type Owner = 'you' | 'agent';

export interface ProjectSession {
  date: string;
  duration_minutes: number | null;
  summary: string;
}

export interface ProjectTimeStats {
  total_estimate_minutes: number;
  done_estimate_minutes: number;
  open_estimate_minutes: number;
  logged_minutes: number;
  diff_minutes: number;
  session_count: number;
  last_worked_on: string | null;
  quiet: boolean;
  days_ago: number | null;
}

export interface Project {
  id: string;
  key: string | null;
  name: string;
  status: 'active' | 'paused' | 'archived';
  area: string;
  color: string;
  description: string;
  folder?: string | null;
  version: number;
  progress: { done: number; total: number; percent: number };
  blocked_count: number;
  overdue_count: number;
  pending_agent_files: number;
  next_task: { id: string; title: string; due_date: string } | null;
  last_worked_on?: string | null;
  quiet?: boolean;
  days_ago?: number | null;
  sessions?: ProjectSession[];
  time_stats?: ProjectTimeStats;
}

export interface Subtask {
  id: string;
  task_id: string;
  text: string;
  done: boolean;
  sort_order: number;
  version: number;
}

export interface Task {
  id: string;
  key: string | null;
  project_id: string;
  project_name?: string;
  project_color?: string;
  title: string;
  description: string;
  status: TaskStatus;
  blocked_reason: string | null;
  owner: Owner;
  due_date: string | null;
  priority: 'low' | 'medium' | 'high' | null;
  estimate_minutes: number | null;
  created_from: 'manual' | 'template' | 'agent_file';
  created_from_ref: string | null;
  sort_order: number;
  completed_at: string | null;
  version: number;
  created_at: string;
  blocked: boolean;
  overdue: boolean;
  depends_on: string[];
  depends_on_tasks: { id: string; title: string; status: TaskStatus; project_id: string }[];
  subtasks: Subtask[];
}

export interface Overview {
  today: string;
  counts: {
    due_today: number;
    overdue: number;
    blocked: number;
    pending_agent_files: number;
    new_ideas: number;
    open_questions: number;
    active_projects: number;
  };
  projects: Project[];
}

export interface Change {
  id: string;
  entity: string;
  entity_id: string;
  op: 'create' | 'update' | 'delete' | 'restore';
  field: string | null;
  before: any;
  after: any;
  entity_label: string | null;
  undone_by_change_id: string | null;
  task_id: string | null;
  project_id: string | null;
}

export interface Batch {
  batch_id: string;
  actor: 'you' | 'agent' | 'import' | 'system';
  source_file: string | null;
  created_at: string;
  reverts_batch_id: string | null;
  undone: boolean;
  changes: Change[];
}

export interface AgentFile {
  id: string;
  file_id: string;
  file_name: string;
  status: 'pending' | 'applied' | 'rejected' | 'duplicate';
  received_at: string;
  decided_at: string | null;
  error: string | null;
  summary: string | null;
  agent: string | null;
  change_count: number;
  batch_id: string | null;
  project_ids: string[];
}

export interface Conflict {
  key: string;
  change_id: string;
  field: string;
  mine: unknown;
  agent: unknown;
  changed_by: string;
  changed_at: string;
}

export interface PlanItem {
  index: number;
  change_id: string;
  requested_op: string;
  op: 'create' | 'update' | 'delete' | 'noop';
  entity: string;
  id: string | null;
  temp_id: string | null;
  fields: Record<string, unknown>;
  before: Record<string, unknown> | null;
  changed_fields: string[];
  conflicts: Conflict[];
  label: string;
  note?: string;
}

export interface Question {
  id: string;
  file_id: string;
  agent_file_row_id: string;
  question_key: string;
  project_id: string | null;
  task_id: string | null;
  task_title?: string | null;
  project_name?: string | null;
  text: string;
  answer: string | null;
  status: 'open' | 'answered';
  created_at: string;
  answered_at: string | null;
}

export interface Preview {
  file: AgentFile;
  valid: boolean;
  error?: string;
  items: PlanItem[];
  conflicts: Conflict[];
  has_deletes?: boolean;
  questions: Question[];
}

export interface Idea {
  id: string;
  text: string;
  project_id: string | null;
  project_name: string | null;
  project_color: string | null;
  status: 'new' | 'picked_up' | 'dismissed';
  result_type: string | null;
  result_id: string | null;
  agent_note: string | null;
  added_by: 'you' | 'agent';
  message_count: number;
  picked_up_at: string | null;
  created_at: string;
  version: number;
}

export interface FolderStatus {
  path: string;
  watching: boolean;
  last_import_at: string | null;
  message: string | null;
  error: string | null;
}

export interface Settings {
  agent_folder: string;
  auto_apply: boolean;
  db_path: string;
  backups_path: string;
  folder_status: FolderStatus;
}

export interface Note {
  id: string;
  body_md: string;
  version: number;
}

export interface AgentMessage {
  id: string;
  parent_type: 'task' | 'idea';
  parent_id: string;
  project_id: string | null;
  kind: 'note' | 'do_next' | 'ask';
  author: 'you' | 'agent';
  text: string;
  status: 'open' | 'handled';
  reply_to: string | null;
  file_id: string | null;
  created_at: string;
  handled_at: string | null;
  task_title: string | null;
  idea_text: string | null;
  project_name: string | null;
}

export interface Milestone {
  id: string;
  project_id: string;
  key: string | null;
  title: string;
  kind: 'release' | 'feature' | 'change';
  version_label: string | null;
  status: 'planned' | 'achieved';
  target_date: string | null;
  achieved_on: string | null;
  description: string;
  achieved: string;
  version: number;
  created_at: string;
}

export interface SearchHit {
  type: 'project' | 'task' | 'subtask' | 'note' | 'idea' | 'milestone';
  id: string;
  title: string;
  snippet: string;
  project_id: string | null;
  project_name: string | null;
  project_color: string | null;
  task_id: string | null;
  status: string | null;
}

export interface Handoff {
  message_id: string;
  task_id: string;
  task_title: string;
  project_id: string | null;
  project_name: string | null;
  project_color: string | null;
  text: string;
  status: 'open' | 'handled';
  sent_at: string;
  handled_at: string | null;
  reply: string | null;
}

export interface TodayData {
  today: string;
  overdue: Task[];
  due_today: Task[];
  next_steps: { project: { id: string; name: string; color: string; area: string; progress: Project['progress']; quiet?: boolean; last_worked_on?: string | null }; task: Task | null }[];
  blocked: Task[];
  with_agent: Handoff[];
  done_today: Task[];
  week: { date: string; tasks: Task[] }[];
  week_start: string;
  done_this_week: number;
  pending_files: number;
  open_questions: number;
}

export interface WeeklyCompletedTask {
  id: string;
  title: string;
  project_id: string;
  project_name: string;
  project_color: string;
  completed_at: string;
  owner: string;
  estimate_minutes: number | null;
}

export interface WeeklySlippedTask {
  id: string;
  title: string;
  project_id: string;
  project_name: string;
  project_color: string;
  due_date: string;
  overdue: boolean;
  priority: string | null;
  owner: string;
  blocked: boolean;
  blocked_reason: string | null;
}

export interface WeeklyQuietProject {
  id: string;
  name: string;
  color: string;
  area: string;
  last_worked_on: string | null;
  days_ago: number | null;
  open_tasks_count: number;
  next_step: { id: string; title: string } | null;
}

export interface WeeklyQuestion {
  id: string;
  question_key: string;
  text: string;
  project_id: string | null;
  project_name: string | null;
  task_id: string | null;
  task_title: string | null;
  created_at: string;
}

export interface WeeklyReviewData {
  today: string;
  week_start: string;
  week_end: string;
  completed_this_week: WeeklyCompletedTask[];
  slipped_tasks: WeeklySlippedTask[];
  quiet_projects: WeeklyQuietProject[];
  unanswered_questions: WeeklyQuestion[];
  metrics: {
    done_count: number;
    slipped_count: number;
    quiet_count: number;
    questions_count: number;
    total_logged_minutes_this_week: number;
    total_done_estimates_this_week: number;
  };
}
