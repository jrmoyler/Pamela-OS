import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").defaultRandom().primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ───────────────────────────── Identity ───────────────────────────── */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("owner"),
  createdAt: createdAt(),
});

/* ───────────────────────────── Storage ───────────────────────────── */

export const files = pgTable("files", {
  id: id(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull().default(0),
  storageKey: text("storage_key").notNull(),
  kind: text("kind").notNull().default("other"), // audio | video | image | document | other
  source: text("source").notNull().default("upload"), // upload | link | gdrive | dropbox | claude | chatgpt | meta | hermes | other
  sourceRef: text("source_ref"), // external id or URL it came from, used to skip re-imports
  description: text("description"),
  tags: text("tags").array().notNull().default([]),
  createdAt: createdAt(),
});

/* ───────────────────────────── Command Center ───────────────────────────── */

/** Keys for outside agents (Claude, ChatGPT, Meta Muse, Hermes) to reach Pamela OS over MCP / REST. */
export const agentKeys = pgTable("agent_keys", {
  id: id(),
  name: text("name").notNull(),
  client: text("client").notNull().default("other"), // claude | chatgpt | meta | hermes | other
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  scopes: text("scopes").array().notNull().default([]), // read | write | computer
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
});

/** Everything pushed in from outside: files, notes and links from her agents and connected sources. */
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: id(),
    kind: text("kind").notNull().default("note"), // file | note | link
    source: text("source").notNull().default("other"),
    agentKeyId: uuid("agent_key_id").references(() => agentKeys.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body"),
    url: text("url"),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    computerTaskId: uuid("computer_task_id"),
    status: text("status").notNull().default("new"), // new | filed | dismissed
    createdAt: createdAt(),
  },
  (t) => [index("inbox_items_status_idx").on(t.status, t.createdAt)],
);

/** Work handed to Hermes Agent on her computer: browser and desktop tasks. */
export const computerTasks = pgTable(
  "computer_tasks",
  {
    id: id(),
    instruction: text("instruction").notNull(),
    kind: text("kind").notNull().default("browser"), // browser | computer | files
    status: text("status").notNull().default("queued"), // awaiting_approval | queued | running | done | failed | cancelled
    createdBy: text("created_by").notNull().default("user"), // user | rj | claude | chatgpt | meta | other
    claimedBy: text("claimed_by"), // push (sent to the Hermes API) | pull (Hermes fetched it over MCP)
    result: text("result"),
    fileIds: jsonb("file_ids").$type<string[]>().notNull().default([]),
    error: text("error"),
    claimedAt: ts("claimed_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("computer_tasks_status_idx").on(t.status, t.createdAt)],
);

/* ───────────────────────────── CRM ───────────────────────────── */

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    email: text("email"),
    phone: text("phone"),
    company: text("company"),
    title: text("title"),
    tags: text("tags").array().notNull().default([]),
    relationshipTypes: text("relationship_types").array().notNull().default([]),
    source: text("source"),
    notes: text("notes"),
    socialHandles: jsonb("social_handles").$type<Record<string, string>>().notNull().default({}),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    lastActivityAt: ts("last_activity_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_email_idx").on(t.email), index("contacts_phone_idx").on(t.phone)],
);

export const pipelines = pgTable("pipelines", {
  id: id(),
  name: text("name").notNull(),
  businessLine: text("business_line").notNull(),
  color: text("color").notNull().default("#6a1b9a"),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
});

export const pipelineStages = pgTable("pipeline_stages", {
  id: id(),
  pipelineId: uuid("pipeline_id")
    .notNull()
    .references(() => pipelines.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  isWon: boolean("is_won").notNull().default(false),
  isLost: boolean("is_lost").notNull().default(false),
});

export const deals = pgTable(
  "deals",
  {
    id: id(),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    valueCents: integer("value_cents").notNull().default(0),
    status: text("status").notNull().default("open"), // open | won | lost
    position: integer("position").notNull().default(0),
    dueDate: ts("due_date"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("deals_pipeline_idx").on(t.pipelineId), index("deals_contact_idx").on(t.contactId)],
);

/** Polymorphic timeline. Every touchpoint lands here. */
export const activities = pgTable(
  "activities",
  {
    id: id(),
    type: text("type").notNull(), // call | sms | email | meeting | note | purchase | form | booking | dm | task | automation | voicemail | social | system
    direction: text("direction").notNull().default("internal"), // inbound | outbound | internal
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    title: text("title").notNull(),
    body: text("body"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: ts("occurred_at").defaultNow().notNull(),
  },
  (t) => [index("activities_contact_idx").on(t.contactId), index("activities_occurred_idx").on(t.occurredAt)],
);

/* ───────────────────────────── Meetings ───────────────────────────── */

export type TranscriptSegment = { speaker: string; start: number; end: number; text: string };
export type ActionItem = { text: string; owner?: string; due?: string; taskId?: string };

export const meetings = pgTable("meetings", {
  id: id(),
  title: text("title").notNull(),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
  attendees: jsonb("attendees").$type<string[]>().notNull().default([]),
  startedAt: ts("started_at").defaultNow().notNull(),
  durationSec: integer("duration_sec").notNull().default(0),
  audioFileId: uuid("audio_file_id").references(() => files.id, { onDelete: "set null" }),
  transcript: text("transcript"),
  segments: jsonb("segments").$type<TranscriptSegment[]>().notNull().default([]),
  speakers: jsonb("speakers").$type<string[]>().notNull().default([]),
  summary: text("summary"),
  actionItems: jsonb("action_items").$type<ActionItem[]>().notNull().default([]),
  status: text("status").notNull().default("recording"), // recording | processing | ready | failed
  error: text("error"),
  createdAt: createdAt(),
});

/* ───────────────────────────── Work management ───────────────────────────── */

export const boards = pgTable("boards", {
  id: id(),
  name: text("name").notNull(),
  businessLine: text("business_line"),
  columns: jsonb("columns").$type<{ key: string; name: string }[]>().notNull().default([]),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
});

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("todo"), // todo | doing | done
    priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
    dueAt: ts("due_at"),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    meetingId: uuid("meeting_id").references(() => meetings.id, { onDelete: "set null" }),
    source: text("source").notNull().default("manual"), // manual | meeting | rj | automation | receptionist
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_due_idx").on(t.dueAt)],
);

/** Placement of a task on a board column. */
export const boardItems = pgTable(
  "board_items",
  {
    id: id(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    columnKey: text("column_key").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("board_items_task_unique").on(t.boardId, t.taskId)],
);

/* ───────────────────────────── The glue ───────────────────────────── */

export const events = pgTable(
  "events",
  {
    id: id(),
    type: text("type").notNull(),
    source: text("source").notNull().default("system"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    processedAt: ts("processed_at"),
  },
  (t) => [index("events_type_idx").on(t.type), index("events_created_idx").on(t.createdAt)],
);

export type AutomationCondition = { field: string; op: "eq" | "neq" | "contains" | "exists" | "gt" | "lt"; value?: unknown };
export type AutomationAction = { type: string; params: Record<string, unknown> };

export const automations = pgTable("automations", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  trigger: text("trigger").notNull(),
  conditions: jsonb("conditions").$type<AutomationCondition[]>().notNull().default([]),
  actions: jsonb("actions").$type<AutomationAction[]>().notNull().default([]),
  lastRunAt: ts("last_run_at"),
  createdAt: createdAt(),
});

export type RunStep = { at: string; action: string; status: "ok" | "error" | "skipped"; detail?: string };

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    automationId: uuid("automation_id").references(() => automations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("running"), // running | succeeded | failed | skipped
    steps: jsonb("steps").$type<RunStep[]>().notNull().default([]),
    error: text("error"),
    startedAt: ts("started_at").defaultNow().notNull(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("automation_runs_started_idx").on(t.startedAt)],
);

/** Every outbound action is parked here until Pamela approves it. */
export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    kind: text("kind").notNull(), // email | sms | dm | social_post | charge | publish_page | voice_send | song_release | design_publish | campaign_send | clip_post
    title: text("title").notNull(),
    summary: text("summary"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | sent | failed
    brandIssues: jsonb("brand_issues").$type<string[]>().notNull().default([]),
    createdBy: text("created_by").notNull().default("user"), // user | rj | automation | receptionist | sequence
    scheduledFor: ts("scheduled_for"),
    decidedAt: ts("decided_at"),
    executedAt: ts("executed_at"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_status_idx").on(t.status)],
);

/** Queue for heavy work (video, transcription) — executed by the VPS worker or inline. */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("queued"), // queued | running | done | failed
    attempts: integer("attempts").notNull().default(0),
    runAt: ts("run_at").defaultNow().notNull(),
    lockedAt: ts("locked_at"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.runAt)],
);

/* ───────────────────────────── Receptionist ───────────────────────────── */

export type CallTurn = { role: "caller" | "receptionist"; text: string; at: string };

export const calls = pgTable("calls", {
  id: id(),
  callSid: text("call_sid").unique(),
  fromNumber: text("from_number"),
  toNumber: text("to_number"),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  status: text("status").notNull().default("in_progress"), // in_progress | completed | transferred | voicemail
  turns: jsonb("turns").$type<CallTurn[]>().notNull().default([]),
  intent: text("intent"),
  urgency: text("urgency").notNull().default("normal"), // normal | urgent | spam
  disposition: text("disposition"), // booked | message | transferred | spam | info
  summary: text("summary"),
  bookingId: uuid("booking_id"),
  startedAt: ts("started_at").defaultNow().notNull(),
  endedAt: ts("ended_at"),
});

/* ───────────────────────────── Funnels, pages, booking, payments ───────────────────────────── */

export type PageBlock = { id: string; type: string; props: Record<string, unknown> };

export const pages = pgTable("pages", {
  id: id(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("landing"), // landing | lead_magnet | thank_you | sales
  blocks: jsonb("blocks").$type<PageBlock[]>().notNull().default([]),
  published: boolean("published").notNull().default(false),
  views: integer("views").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type FormField = { key: string; label: string; type: "text" | "email" | "tel" | "textarea" | "select"; required?: boolean; options?: string[] };

export const forms = pgTable("forms", {
  id: id(),
  name: text("name").notNull(),
  fields: jsonb("fields").$type<FormField[]>().notNull().default([]),
  tags: text("tags").array().notNull().default([]),
  relationshipType: text("relationship_type"),
  pipelineId: uuid("pipeline_id").references(() => pipelines.id, { onDelete: "set null" }),
  stageId: uuid("stage_id").references(() => pipelineStages.id, { onDelete: "set null" }),
  sequenceId: uuid("sequence_id"),
  leadMagnetFileId: uuid("lead_magnet_file_id").references(() => files.id, { onDelete: "set null" }),
  thankYouSlug: text("thank_you_slug"),
  submissions: integer("submissions").notNull().default(0),
  createdAt: createdAt(),
});

export const formSubmissions = pgTable("form_submissions", {
  id: id(),
  formId: uuid("form_id")
    .notNull()
    .references(() => forms.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  data: jsonb("data").$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
});

export type WeeklyHours = Record<string, { start: string; end: string }[]>; // "mon".."sun" → ranges "09:00"-"17:00"

export const bookingTypes = pgTable("booking_types", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  durationMin: integer("duration_min").notNull().default(30),
  bufferMin: integer("buffer_min").notNull().default(10),
  priceCents: integer("price_cents").notNull().default(0),
  location: text("location").notNull().default("Phone call"),
  hours: jsonb("hours").$type<WeeklyHours>().notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    bookingTypeId: uuid("booking_type_id").references(() => bookingTypes.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    status: text("status").notNull().default("confirmed"), // confirmed | cancelled | completed | pending_payment
    source: text("source").notNull().default("web"), // web | receptionist | rj | manual
    notes: text("notes"),
    paymentId: uuid("payment_id"),
    createdAt: createdAt(),
  },
  (t) => [index("bookings_starts_idx").on(t.startsAt)],
);

export const payments = pgTable("payments", {
  id: id(),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  description: text("description").notNull(),
  status: text("status").notNull().default("pending"), // pending | paid | failed | refunded
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  createdAt: createdAt(),
  paidAt: ts("paid_at"),
});

/* ───────────────────────────── Campaigns & sequences ───────────────────────────── */

export const sequences = pgTable("sequences", {
  id: id(),
  name: text("name").notNull(),
  trigger: text("trigger"), // event type that auto-enrolls, e.g. form.submitted
  triggerFilter: jsonb("trigger_filter").$type<Record<string, string>>().notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const sequenceSteps = pgTable("sequence_steps", {
  id: id(),
  sequenceId: uuid("sequence_id")
    .notNull()
    .references(() => sequences.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  delayMinutes: integer("delay_minutes").notNull().default(0),
  channel: text("channel").notNull().default("email"), // email | sms
  subject: text("subject"),
  body: text("body").notNull(),
});

export const enrollments = pgTable(
  "enrollments",
  {
    id: id(),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequences.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    nextStep: integer("next_step").notNull().default(0),
    nextRunAt: ts("next_run_at"),
    status: text("status").notNull().default("active"), // active | completed | stopped
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("enrollments_unique").on(t.sequenceId, t.contactId)],
);

export const campaigns = pgTable("campaigns", {
  id: id(),
  name: text("name").notNull(),
  channel: text("channel").notNull().default("email"),
  subject: text("subject"),
  body: text("body").notNull().default(""),
  audienceTags: text("audience_tags").array().notNull().default([]),
  status: text("status").notNull().default("draft"), // draft | awaiting_approval | sending | sent
  recipients: integer("recipients").notNull().default(0),
  sentAt: ts("sent_at"),
  createdAt: createdAt(),
});

/* ───────────────────────────── Social ───────────────────────────── */

export const socialTriggers = pgTable("social_triggers", {
  id: id(),
  name: text("name").notNull(),
  platform: text("platform").notNull().default("instagram"), // instagram | facebook
  keyword: text("keyword").notNull(),
  postId: text("post_id"),
  dmMessage: text("dm_message").notNull(),
  pageSlug: text("page_slug"),
  tags: text("tags").array().notNull().default([]),
  autoApprove: boolean("auto_approve").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  hits: integer("hits").notNull().default(0),
  createdAt: createdAt(),
});

export const socialPosts = pgTable("social_posts", {
  id: id(),
  platform: text("platform").notNull(),
  caption: text("caption").notNull(),
  mediaFileId: uuid("media_file_id").references(() => files.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"), // draft | awaiting_approval | published | failed
  externalId: text("external_id"),
  scheduledFor: ts("scheduled_for"),
  publishedAt: ts("published_at"),
  sourceType: text("source_type"),
  sourceId: uuid("source_id"),
  createdAt: createdAt(),
});

/* ───────────────────────────── Studios ───────────────────────────── */

export const voiceClones = pgTable("voice_clones", {
  id: id(),
  name: text("name").notNull(),
  provider: text("provider").notNull().default("elevenlabs"), // elevenlabs | chatterbox | browser
  providerVoiceId: text("provider_voice_id"),
  sampleFileIds: jsonb("sample_file_ids").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("draft"), // draft | ready | failed
  consentConfirmedAt: ts("consent_confirmed_at"),
  createdAt: createdAt(),
});

export const voiceDrafts = pgTable("voice_drafts", {
  id: id(),
  voiceCloneId: uuid("voice_clone_id").references(() => voiceClones.id, { onDelete: "set null" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  purpose: text("purpose").notNull().default("voice_note"), // voice_note | voicemail_drop | podcast | social
  script: text("script").notNull(),
  audioFileId: uuid("audio_file_id").references(() => files.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"), // draft | rendering | awaiting_approval | approved | sent | failed
  createdAt: createdAt(),
});

export const songs = pgTable("songs", {
  id: id(),
  title: text("title").notNull(),
  prompt: text("prompt"),
  style: text("style"),
  lyrics: text("lyrics"),
  status: text("status").notNull().default("idea"), // idea | generating | draft | approved | released | failed
  provider: text("provider").notNull().default("suno"),
  providerId: text("provider_id"),
  audioFileId: uuid("audio_file_id").references(() => files.id, { onDelete: "set null" }),
  audioUrl: text("audio_url"),
  coverDesignId: uuid("cover_design_id"),
  releaseDate: ts("release_date"),
  releaseChecklist: jsonb("release_checklist").$type<Record<string, boolean>>().notNull().default({}),
  createdAt: createdAt(),
});

export const designs = pgTable("designs", {
  id: id(),
  title: text("title").notNull(),
  templateKey: text("template_key").notNull(),
  format: text("format").notNull().default("square"), // square | story | flyer | banner | cover
  fields: jsonb("fields").$type<Record<string, string>>().notNull().default({}),
  canvaDesignId: text("canva_design_id"),
  exportFileId: uuid("export_file_id").references(() => files.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"), // draft | awaiting_approval | approved
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A node canvas in the Create studio. The graph shape lives in lib/studio/graph.ts. */
export const studioFlows = pgTable("studio_flows", {
  id: id(),
  title: text("title").notNull(),
  graph: jsonb("graph").$type<{ nodes: unknown[]; edges: unknown[] }>().notNull().default({ nodes: [], edges: [] }),
  coverFileId: uuid("cover_file_id").references(() => files.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One run of one canvas node: what was asked, which engine ran it, and the files it made. */
export const studioGenerations = pgTable(
  "studio_generations",
  {
    id: id(),
    flowId: uuid("flow_id").references(() => studioFlows.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    kind: text("kind").notNull(), // the node type: generate_image | edit_image | upscale | remove_bg | generate_video | voice | design | clips
    provider: text("provider"), // comfyui | replicate | fal | elevenlabs | chatterbox | pamela
    model: text("model"),
    prompt: text("prompt"),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    inputFileIds: jsonb("input_file_ids").$type<string[]>().notNull().default([]),
    outputFileIds: jsonb("output_file_ids").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("queued"), // queued | running | done | failed
    error: text("error"),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("studio_generations_flow_idx").on(t.flowId, t.nodeId, t.createdAt)],
);

export type ClipSuggestion = {
  id: string;
  start: number;
  end: number;
  score: number;
  hook: string;
  caption: string;
  status: "suggested" | "approved" | "rejected" | "posted";
  renderedFileId?: string;
};

export const videos = pgTable("videos", {
  id: id(),
  title: text("title").notNull(),
  sourceFileId: uuid("source_file_id").references(() => files.id, { onDelete: "set null" }),
  durationSec: real("duration_sec").notNull().default(0),
  transcript: text("transcript"),
  segments: jsonb("segments").$type<TranscriptSegment[]>().notNull().default([]),
  clips: jsonb("clips").$type<ClipSuggestion[]>().notNull().default([]),
  status: text("status").notNull().default("uploaded"), // uploaded | processing | ready | failed
  error: text("error"),
  createdAt: createdAt(),
});

/* ───────────────────────────── Operator layer (RJ) ───────────────────────────── */

export const rjThreads = pgTable("rj_threads", {
  id: id(),
  title: text("title").notNull().default("New conversation"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rjMessages = pgTable(
  "rj_messages",
  {
    id: id(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => rjThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant | tool
    content: text("content").notNull().default(""),
    toolCalls: jsonb("tool_calls").$type<{ id: string; name: string; args: Record<string, unknown>; result?: unknown }[]>(),
    provider: text("provider"),
    createdAt: createdAt(),
  },
  (t) => [index("rj_messages_thread_idx").on(t.threadId)],
);

export const briefings = pgTable("briefings", {
  id: id(),
  date: text("date").notNull().unique(), // YYYY-MM-DD
  content: text("content").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  provider: text("provider"),
  createdAt: createdAt(),
});

/* ───────────────────────────── Settings ───────────────────────────── */

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  encrypted: boolean("encrypted").notNull().default(false),
  updatedAt: updatedAt(),
});
