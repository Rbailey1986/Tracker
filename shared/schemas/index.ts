import { z } from 'zod';

// ---------- Enums ----------

export const ProjectStatus = z.enum(['active', 'paused', 'archived']);
export const TaskStatus = z.enum(['not_started', 'in_progress', 'blocked', 'done', 'on_hold']);
export const Owner = z.enum(['you', 'agent']);
export const Priority = z.enum(['low', 'medium', 'high']);
export const CreatedFrom = z.enum(['manual', 'template', 'agent_file']);
export const Actor = z.enum(['you', 'agent', 'import', 'system']);
export const IdeaStatus = z.enum(['new', 'picked_up', 'dismissed']);
export const IdeaResultType = z.enum(['task', 'project', 'note', 'question', 'none']);
export const ParentType = z.enum(['project', 'task']);
export const EntityName = z.enum(['project', 'task', 'subtask', 'dependency', 'note', 'idea', 'milestone']);
export const MilestoneKind = z.enum(['release', 'feature', 'change']);
export const MilestoneStatus = z.enum(['planned', 'achieved']);
export const AgentFileStatus = z.enum(['pending', 'applied', 'rejected', 'duplicate']);

export type ProjectStatus = z.infer<typeof ProjectStatus>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type Owner = z.infer<typeof Owner>;
export type Priority = z.infer<typeof Priority>;
export type Actor = z.infer<typeof Actor>;
export type IdeaStatus = z.infer<typeof IdeaStatus>;
export type IdeaResultType = z.infer<typeof IdeaResultType>;
export type ParentType = z.infer<typeof ParentType>;
export type EntityName = z.infer<typeof EntityName>;
export type AgentFileStatus = z.infer<typeof AgentFileStatus>;

// ---------- Field types ----------

export const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')
  .refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')), 'Not a real date');
export const Color = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a #RRGGBB colour');
export const Key = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._-]+$/, 'Keys may use letters, digits, dot, dash and underscore');
/** An existing id, or "$<temp_id>" referring to an item created earlier in the same agent file. */
export const Ref = z.string().min(1).max(130);

// ---------- Editable fields per entity ----------
// These are the only columns the UI or an agent may set. ids, versions and timestamps belong to the app.

export const ProjectFields = z
  .object({
    key: Key.nullable(),
    name: z.string().trim().min(1).max(200),
    status: ProjectStatus,
    area: z.string().max(80),
    color: Color,
    description: z.string().max(2000),
    folder: z.string().max(500).nullable().optional(),
  })
  .strict();

export const TaskFields = z
  .object({
    key: Key.nullable(),
    project_id: Ref,
    title: z.string().trim().min(1).max(300),
    description: z.string().max(20000),
    status: TaskStatus,
    blocked_reason: z.string().max(500).nullable(),
    owner: Owner,
    due_date: DateOnly.nullable(),
    priority: Priority.nullable(),
    estimate_minutes: z.number().int().min(0).max(100000).nullable(),
    sort_order: z.number().int(),
  })
  .strict();

export const SubtaskFields = z
  .object({
    task_id: Ref,
    text: z.string().trim().min(1).max(500),
    done: z.boolean(),
    sort_order: z.number().int(),
  })
  .strict();

export const DependencyFields = z
  .object({
    task_id: Ref,
    depends_on_task_id: Ref,
  })
  .strict();

export const NoteFields = z
  .object({
    parent_type: ParentType,
    parent_id: Ref,
    body_md: z.string().max(200000),
  })
  .strict();

export const IdeaFields = z
  .object({
    text: z.string().trim().min(1).max(2000),
    project_id: Ref.nullable(),
    status: IdeaStatus,
    result_type: IdeaResultType.nullable(),
    result_id: Ref.nullable(),
    agent_note: z.string().max(500).nullable(),
    added_by: z.enum(['you', 'agent']),
  })
  .strict();

/** Fields the agent may set when marking an idea. */
export const IdeaAgentFields = IdeaFields.pick({
  status: true,
  result_type: true,
  result_id: true,
  agent_note: true,
}).strict();

export const MilestoneFields = z
  .object({
    project_id: Ref,
    key: Key.nullable(),
    title: z.string().trim().min(1).max(300),
    kind: MilestoneKind.describe('release: a new version. feature: a new feature. change: a major change.'),
    version_label: z.string().trim().max(40).nullable().describe('The version number for a release, such as "1.4.0".'),
    status: MilestoneStatus,
    target_date: DateOnly.nullable(),
    achieved_on: DateOnly.nullable().describe('Set automatically to today when status becomes achieved, unless given.'),
    description: z.string().max(2000).describe('One or two sentences: what this milestone is.'),
    achieved: z.string().max(10000).describe('What was achieved, as short Markdown bullets.'),
  })
  .strict();
export const MilestoneCreate = MilestoneFields.partial().required({ project_id: true, title: true }).strict();

export const EditableFields = {
  project: ProjectFields,
  task: TaskFields,
  subtask: SubtaskFields,
  dependency: DependencyFields,
  note: NoteFields,
  idea: IdeaFields,
  milestone: MilestoneFields,
} as const;

// Create: required fields are the ones without a sensible default.
export const ProjectCreate = ProjectFields.partial().required({ name: true }).strict();
export const TaskCreate = TaskFields.partial().required({ project_id: true, title: true }).strict();
export const SubtaskCreate = SubtaskFields.partial().required({ task_id: true, text: true }).strict();
export const DependencyCreate = DependencyFields;
export const NoteCreate = NoteFields;
export const IdeaCreate = IdeaFields.pick({ text: true, project_id: true }).partial({ project_id: true }).strict();

// ---------- Agent update file ----------

const changeBase = {
  change_id: z.string().min(1).max(100).describe('A new UUID for every change. Never reuse one.'),
};
const tempId = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,120}$/)
  .describe('Name this new item so later changes in the same file can refer to it as "$<temp_id>".');
const baseVersion = z
  .number()
  .int()
  .min(0)
  .describe("The item's version from snapshot.json.");

const create = <E extends string, F extends z.ZodTypeAny>(entity: E, fields: F) =>
  z.object({ ...changeBase, op: z.literal('create'), entity: z.literal(entity), temp_id: tempId.optional(), fields }).strict();
const update = <E extends string, F extends z.ZodTypeAny>(entity: E, fields: F) =>
  z
    .object({ ...changeBase, op: z.literal('update'), entity: z.literal(entity), id: z.string().min(1), base_version: baseVersion, fields })
    .strict();
const upsert = <E extends string, F extends z.ZodTypeAny>(entity: E, fields: F) =>
  z
    .object({
      ...changeBase,
      op: z.literal('upsert'),
      entity: z.literal(entity),
      temp_id: tempId.optional(),
      base_version: baseVersion.optional(),
      fields,
    })
    .strict();
const del = <E extends string>(entity: E) =>
  z.object({ ...changeBase, op: z.literal('delete'), entity: z.literal(entity), id: z.string().min(1), base_version: baseVersion }).strict();

/** Every allowed (op, entity) pair. The validator picks one by op and entity, so error messages stay specific. */
export const ChangeVariants = {
  'create:project': create('project', ProjectCreate),
  'create:task': create('task', TaskCreate),
  'create:subtask': create('subtask', SubtaskCreate),
  'create:note': create('note', NoteCreate),
  'create:dependency': create('dependency', DependencyCreate),
  'create:idea': create('idea', IdeaCreate),
  'create:milestone': create('milestone', MilestoneCreate),
  'update:project': update('project', ProjectFields.partial().strict()),
  'update:task': update('task', TaskFields.partial().strict()),
  'update:subtask': update('subtask', SubtaskFields.partial().strict()),
  'update:note': update('note', NoteFields.pick({ body_md: true }).strict()),
  'update:idea': update('idea', IdeaAgentFields.partial().required({ status: true }).strict()),
  'upsert:project': upsert('project', ProjectCreate.required({ key: true }).extend({ key: Key }).strict()),
  'upsert:task': upsert('task', TaskCreate.extend({ key: Key }).strict()),
  'upsert:subtask': upsert('subtask', SubtaskCreate),
  'upsert:note': upsert('note', NoteCreate),
  'upsert:idea': upsert('idea', IdeaCreate),
  'upsert:milestone': upsert('milestone', MilestoneCreate.extend({ key: Key }).strict()),
  'update:milestone': update('milestone', MilestoneFields.partial().strict()),
  'delete:milestone': del('milestone'),
  'delete:project': del('project'),
  'delete:task': del('task'),
  'delete:subtask': del('subtask'),
  'delete:note': del('note'),
  'delete:dependency': z
    .object({ ...changeBase, op: z.literal('delete'), entity: z.literal('dependency'), fields: DependencyFields })
    .strict(),
} as const;
export type ChangeVariantKey = keyof typeof ChangeVariants;

const variantList = Object.values(ChangeVariants) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]];
export const AgentChange = z.union(variantList);

/** Loose envelope used for the first validation pass, so each change can then be checked against its own variant. */
export const AgentChangeEnvelope = z
  .object({
    change_id: z.string().min(1).max(100),
    op: z.enum(['create', 'update', 'upsert', 'delete']),
    entity: EntityName,
  })
  .passthrough();

export const AgentQuestion = z
  .object({
    key: z.string().min(1).max(120).describe('Your own stable name for the question.'),
    text: z.string().trim().min(1).max(2000),
    project_id: Ref.optional(),
    task_id: Ref.optional(),
  })
  .strict();

export const MessageReply = z
  .object({
    message_id: z.string().min(1).describe('The id of a message from "messages" in snapshot.json.'),
    reply: z.string().max(5000).optional().describe('Your answer, shown under the message in the tracker.'),
    handled: z
      .boolean()
      .default(true)
      .describe('true (default) takes it off the open list. Use false to reply but keep it open.'),
  })
  .strict();

const fileShape = {
  schema_version: z.literal(1),
  file_id: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,120}$/, 'file_id may use letters, digits, dot, dash and underscore')
    .describe('Unique per file. The file is named inbox/<file_id>.json.'),
  created_at: z.string().datetime({ offset: true }),
  agent: z.string().min(1).max(100),
  summary: z.string().max(1000),
  questions: z.array(AgentQuestion).max(200).optional(),
  message_replies: z.array(MessageReply).max(500).optional(),
};

export const MAX_CHANGES = 2000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const UpdateFileEnvelope = z
  .object({ ...fileShape, changes: z.array(AgentChangeEnvelope).max(MAX_CHANGES) })
  .strict();
/** The full contract, used to generate schema/update-file.schema.json. */
export const UpdateFile = z.object({ ...fileShape, changes: z.array(AgentChange).max(MAX_CHANGES) }).strict();

export type AgentChange = {
  change_id: string;
  op: 'create' | 'update' | 'upsert' | 'delete';
  entity: EntityName;
  id?: string;
  temp_id?: string;
  base_version?: number;
  fields?: Record<string, unknown>;
};
export type UpdateFile = {
  schema_version: 1;
  file_id: string;
  created_at: string;
  agent: string;
  summary: string;
  changes: AgentChange[];
  questions?: z.infer<typeof AgentQuestion>[];
  message_replies?: z.infer<typeof MessageReply>[];
};

// ---------- Snapshot ----------

const versioned = { id: z.string(), version: z.number().int() };

export const Snapshot = z
  .object({
    schema_version: z.literal(1),
    generated_at: z.string().datetime(),
    projects: z.array(
      z.object({
        ...versioned,
        key: z.string().nullable(),
        name: z.string(),
        status: ProjectStatus,
        area: z.string(),
        color: z.string(),
        description: z.string(),
        progress: z.object({ done: z.number().int(), total: z.number().int() }),
      }),
    ),
    tasks: z.array(
      z.object({
        ...versioned,
        key: z.string().nullable(),
        project_id: z.string(),
        title: z.string(),
        description: z.string(),
        status: TaskStatus,
        blocked: z.boolean(),
        blocked_reason: z.string().nullable(),
        overdue: z.boolean(),
        owner: Owner,
        due_date: z.string().nullable(),
        priority: Priority.nullable(),
        estimate_minutes: z.number().int().nullable(),
        sort_order: z.number().int(),
        completed_at: z.string().nullable(),
        depends_on: z.array(z.string()),
        subtasks: z.array(z.object({ ...versioned, text: z.string(), done: z.boolean(), sort_order: z.number().int() })),
      }),
    ),
    notes: z.array(z.object({ ...versioned, parent_type: ParentType, parent_id: z.string(), body_md: z.string() })),
    milestones: z.array(
      z.object({
        ...versioned,
        project_id: z.string(),
        key: z.string().nullable(),
        title: z.string(),
        kind: MilestoneKind,
        version_label: z.string().nullable(),
        status: MilestoneStatus,
        target_date: z.string().nullable(),
        achieved_on: z.string().nullable(),
        description: z.string(),
        achieved: z.string(),
      }),
    ),
    ideas: z.array(
      z.object({
        ...versioned,
        text: z.string(),
        project_id: z.string().nullable(),
        added_by: z.enum(['you', 'agent']).describe('"you": the user wrote it for you to act on. "agent": you suggested it; it waits for the user.'),
        created_at: z.string(),
      }),
    ),
    messages: z
      .array(
        z.object({
          id: z.string(),
          kind: z.enum(['note', 'do_next']).describe('note: a note or answer for you. do_next: the user handed you this task to do next.'),
          parent_type: z.enum(['task', 'idea']),
          parent_id: z.string(),
          project_id: z.string().nullable(),
          about: z.string().describe("The task's title or the idea's text."),
          text: z.string(),
          created_at: z.string(),
        }),
      )
      .describe("The user's open notes and hand-offs for you, oldest first."),
    open_questions: z.array(
      z.object({
        id: z.string(),
        file_id: z.string(),
        key: z.string(),
        text: z.string(),
        project_id: z.string().nullable(),
        task_id: z.string().nullable(),
        asked_at: z.string(),
      }),
    ),
  })
  .strict();
export type Snapshot = z.infer<typeof Snapshot>;

// ---------- Answers file ----------

export const AnswerFile = z.object({
  question_id: z.string(),
  file_id: z.string(),
  key: z.string(),
  question: z.string(),
  answer: z.string(),
  answered_at: z.string(),
});
