export const DEAL_STAGES = [
  "Identified",
  "Research",
  "Dossier",
  "Qualified",
  "Contacted",
  "Responding",
  "Discovery",
  "Proposal",
  "Negotiating",
  "Won",
  "Lost",
  "Nurture",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export const STAGE_PROBABILITY: Record<DealStage, number> = {
  Identified: 0,
  Research: 10,
  Dossier: 15,
  Qualified: 20,
  Contacted: 25,
  Responding: 37.5,
  Discovery: 50,
  Proposal: 75,
  Negotiating: 90,
  Won: 100,
  Lost: 0,
  Nurture: 5,
};

export const CLIP_STATUSES = [
  "Pending Review",
  "Approved",
  "Needs Edit",
  "Scheduled",
  "Posted",
  "Rejected",
] as const;

export type ClipStatus = (typeof CLIP_STATUSES)[number];

export const TASK_STATUSES = ["To Do", "Doing", "Done", "Blocked"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Deal = {
  id: string;
  brand: string;
  category: string;
  website: string;
  contactName: string;
  contactEmail: string;
  fitScore: number;
  stage: DealStage;
  gate: string;
  priority: number;
  dealValue: number;
  nextAction: string;
  nextDue: string;
  owner: string;
  lastTouch: string;
  touchCount: number;
  notes: string;
};

export type Clip = {
  id: string;
  start: string;
  context: string;
  duration: string;
  score: number;
  platform: string;
  crossPost: string;
  hook: string;
  cta: string;
  status: ClipStatus;
  schedule: string;
  sourcePath: string;
  notes: string;
};

export type OpsTask = {
  id: string;
  title: string;
  area: "Content" | "Brand Deals" | "Weekly Intel" | "Funnel" | "System";
  owner: string;
  due: string;
  status: TaskStatus;
  urgency: "High" | "Medium" | "Low";
};

export type OpsMetrics = {
  emailSubscribers: number;
  emailDelta: number;
  monthlyListeners: number;
  monthlyListenersDelta: number;
  socialAudience: number;
  targetClipsPerWeek: number;
  targetEmailsPerWeek: number;
  pipelineTarget: number;
};

export type ActivityItem = {
  id: string;
  timestamp: string;
  area: "Content" | "Brand Deals" | "Weekly Intel" | "Funnel" | "System";
  title: string;
  detail: string;
};

export type WeeklyBrief = {
  id: string;
  weekOf: string;
  northStar: string;
  worked: string[];
  didntWork: string[];
  nextExperiment: string;
  flags: string[];
};

export type OpsDashboardState = {
  version: number;
  updatedAt: string;
  metrics: OpsMetrics;
  deals: Deal[];
  clips: Clip[];
  tasks: OpsTask[];
  activity: ActivityItem[];
  weeklyBriefs: WeeklyBrief[];
};

export function normalizeStage(stage: string | null | undefined): DealStage {
  const value = (stage ?? "").toLowerCase().replace(/[_-]/g, " ");

  if (value.includes("research")) return "Research";
  if (value.includes("dossier")) return "Dossier";
  if (value.includes("qualified")) return "Qualified";
  if (value.includes("contact")) return "Contacted";
  if (value.includes("respond")) return "Responding";
  if (value.includes("discovery")) return "Discovery";
  if (value.includes("proposal")) return "Proposal";
  if (value.includes("negotiat")) return "Negotiating";
  if (value.includes("won")) return "Won";
  if (value.includes("lost")) return "Lost";
  if (value.includes("nurture")) return "Nurture";

  return "Identified";
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function weightedPipeline(deals: Deal[]) {
  return deals.reduce(
    (sum, deal) => sum + deal.dealValue * (STAGE_PROBABILITY[deal.stage] / 100),
    0
  );
}
