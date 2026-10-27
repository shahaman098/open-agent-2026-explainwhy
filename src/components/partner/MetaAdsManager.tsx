// Partner Meta Ads Manager from origin/kris f9bc19d; Normal MongoDB binding.
"use client";

import { api,q } from "@/components/normal/api";
import { PageSkeleton } from "@/components/normal/PageSkeleton";
import { RunProvider,useRun } from "@/components/normal/run-context";
import { money } from "@/lib/format";
import {
AlignLeft,
ArrowDown,
ArrowUpDown,
Bell,
Bug,
Calendar,
Check,
CircleArrowUp,
Columns3,
Copy,
CreditCard,
Download,
Files,
FlaskConical,
Folder,
Gauge,
HelpCircle,
Layers,
LayoutGrid,
MailOpen,
Megaphone,
Menu,
MoreHorizontal,
Navigation,
PanelTop,
Pencil,
Plus,
RefreshCw,
ScrollText,
Search,
Settings,
Settings2,
SquareActivity,
Table2,
User,
Users,
Workflow,
X
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense,useCallback,useEffect,useMemo,useState } from "react";
import { CampaignHistory } from "./CampaignHistory";

// Small solid caret used on Meta's dropdown buttons
function Caret({ className = "w-[9px] h-[9px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <path d="M1 3h8L5 7.5z" />
    </svg>
  );
}

// Campaign tab icon: blue folder with a white triangle
function CampaignFolderIcon({ className = "w-[19px] h-[19px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h4.2l1.6 1.8H17a1.5 1.5 0 0 1 1.5 1.5v9.2A1.5 1.5 0 0 1 17 17H3a1.5 1.5 0 0 1-1.5-1.5z" fill="#0a66c2" />
      <path d="M10 8.6l2.6 4.6H7.4z" fill="#fff" />
    </svg>
  );
}

// Meta AI search glyph: open ring with a small spark
function AISearchIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12.6 9.6A5.2 5.2 0 1 1 9.8 3" />
      <path d="M12.5 1.8v3M11 3.3h3" strokeWidth="1.3" />
      <path d="M11.9 11.9l2.3 2.3" />
    </svg>
  );
}

// Analyse button's multicolour petal mark
function AnalysePetals({ className = "w-[15px] h-[15px]" }: { className?: string }) {
  const colors = ["#8b5cf6", "#d946ef", "#ec4899", "#6366f1", "#a855f7", "#3b82f6", "#c026d3", "#7c3aed"];
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      {colors.map((color, i) => {
        const angle = (i * Math.PI) / 4;
        return <circle key={color} cx={8 + Math.cos(angle) * 4.6} cy={8 + Math.sin(angle) * 4.6} r="1.75" fill={color} />;
      })}
    </svg>
  );
}

// Opportunity score ring with the score inside
function OpportunityGauge({ score = 100 }: { score?: number }) {
  return (
    <svg className="w-[26px] h-[26px]" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r="11" fill="#fff" stroke="#dce3eb" strokeWidth="2.4" />
      <path d="M5.2 20.8A11 11 0 1 1 20.8 20.8" fill="none" stroke="#0a66c2" strokeWidth="2.4" strokeLinecap="round" />
      <text x="13" y="16.2" textAnchor="middle" fontSize="8.6" fontWeight="700" fill="#1c2b33">{score}</text>
    </svg>
  );
}

type Metric = {
  metricId: string;
  campaignId: string;
  occurredAt: string;
  dailyBudgetMinor: number;
  spendMinor: number;
  clicks: number;
  estimatedConversions: number;
  impressions: number;
  attributedRevenueMinor: number;
  currency: string;
};

type CampaignRecord = {
  campaignId: string;
  name: string;
  currency: string;
  dailyBudgetMinor: number;
  updatedAt: string;
  status?: string;
  platform: string;
  targetCategory: string;
  targetProductIds: string[];
};

type AdsData = {
  campaigns: CampaignRecord[];
  metrics: Metric[];
  events: {
    eventId: string;
    occurredAt: string;
    type?: string;
    payload: Record<string, unknown>;
  }[];
  simulationRunId: string;
  window: { startAt: string; endAt: string };
};

interface SimulatorApiData {
  simulationRunId: string;
  window: { startAt: string; endAt: string };
  daily: Array<{window:{startAt:string;endAt:string};counters:Record<string,number|null>}>;
  comparison: Array<{campaignId:string;roas:number|null;spendMinor:number}>;
  campaigns: CampaignRecord[];
  campaignPerformance: { campaignId: string; impressions: number; clicks: number; spendMinor: number; attributedOrders: number; attributedRevenueMinor: number; roas: number | null }[];
  allActions: { actionId: string; campaignId: string; toolName: string; recordedAt: string; verification: string; agent: string | null; title: string | null; planId: string | null; previousDailyBudgetMinor: number | null; newDailyBudgetMinor: number | null }[];
}

type TabType = "campaigns" | "ad_sets" | "ads";
type FilterPreset = "all" | "delivery" | "actions" | "active";

interface CampaignItem {
  id: string;
  name: string;
  subtitle: string;
  budgetMinor: number;
  currency: string;
  amountSpent: number;
  reach: number;
  tickets: number;
  clicks: number;
  ctr: number | null;
  costPerTicket: number;
  coursePurchases: number;
  costPerCoursePurchase: number;
  conversionValue: number;
  roas: number;
  status: string;
  isNormalAgentTarget?: boolean;
}

interface AdSetItem {
  id: string;
  campaignId: string;
  name: string;
  subtitle: string;
  amountSpent: number;
  reach: number;
  tickets: number;
  costPerTicket: number;
  purchases: number;
  costPerPurchase: number;
  conversionValue: number;
  roas: number;
}

interface AdItem {
  id: string;
  adSetId: string;
  name: string;
  format: "video" | "image" | "carousel";
  status: "active" | "off";
  amountSpent: number;
  landingPageViews: number;
  tickets: number;
  costPerTicket: number;
}

const INITIAL_CAMPAIGNS: CampaignItem[] = [];
const INITIAL_AD_SETS: AdSetItem[] = [];
const INITIAL_ADS: AdItem[] = [];

function toAdsData(source: SimulatorApiData, rangeDays: number): AdsData {
  const metrics = source.campaigns.map((campaign) => {
    const totals = source.campaignPerformance.find((item) => item.campaignId === campaign.campaignId);
    return {
      metricId: `${source.simulationRunId}:${campaign.campaignId}:${rangeDays}`,
      campaignId: campaign.campaignId,
      occurredAt: source.window.endAt,
      dailyBudgetMinor: campaign.dailyBudgetMinor,
      spendMinor: totals?.spendMinor ?? 0,
      impressions: totals?.impressions ?? 0,
      clicks: totals?.clicks ?? 0,
      estimatedConversions: totals?.attributedOrders ?? 0,
      attributedRevenueMinor: totals?.attributedRevenueMinor ?? 0,
      currency: campaign.currency,
    };
  });
  return {
    campaigns: source.campaigns,
    metrics,
    events: source.allActions.map((action) => ({
      eventId: action.actionId,
      occurredAt: action.recordedAt,
      type: "campaign.budget_updated",
      payload: {
        campaignId: action.campaignId,
        previousBudgetMinor: action.previousDailyBudgetMinor,
        newBudgetMinor: action.newDailyBudgetMinor,
        verification: action.verification,
        agent: action.agent,
        planId: action.planId,
      },
    })),
    simulationRunId: source.simulationRunId,
    window: source.window,
  };
}

function toCampaignItems(data: AdsData): CampaignItem[] {
  return data.campaigns.map((campaign) => {
    const metric = data.metrics.find((item) => item.campaignId === campaign.campaignId);
    const conversions = metric?.estimatedConversions ?? 0;
    const amountSpent = metric?.spendMinor ?? 0;
    const conversionValue = metric?.attributedRevenueMinor ?? 0;
    return {
      id: campaign.campaignId,
      name: campaign.name || campaign.campaignId,
      subtitle: `${campaign.platform.replaceAll("_", " ")} · ${campaign.targetCategory || "All categories"}`,
      budgetMinor: campaign.dailyBudgetMinor,
      currency: campaign.currency,
      amountSpent,
      reach: metric?.impressions ?? 0,
      clicks: metric?.clicks ?? 0,
      ctr: metric?.impressions ? (metric.clicks / metric.impressions) : null,
      tickets: 0,
      costPerTicket: 0,
      coursePurchases: conversions,
      costPerCoursePurchase: conversions > 0 ? Math.round(amountSpent / conversions) : 0,
      conversionValue,
      roas: amountSpent > 0 ? conversionValue / amountSpent : 0,
      status: campaign.status ?? "active",
    };
  });
}

function shortRangeDate(isoDate: string): string {
  if (!isoDate) return "—";
  return new Date(isoDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function MetaAdsManager({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const { runId, runs, loaded, unavailable, setRun, withRun } = useRun();
  const selectedRun = runs.find((run) => run.simulationRunId === runId);
  const [data, setData] = useState<AdsData>({ campaigns: [], events: [], metrics: [], simulationRunId: "", window: { startAt: "", endAt: "" } });
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("campaigns");
  const [searchQuery, setSearchQuery] = useState("");
  const [rangeDays, setRangeDays] = useState(30);
  const [filterPreset, setFilterPreset] = useState<FilterPreset>("all");
  const [sortField, setSortField] = useState<string>("amountSpent");
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [showHistory,setShowHistory]=useState(false);
  const [detail,setDetail]=useState<SimulatorApiData|null>(null);
  const [showResultsBar, setShowResultsBar] = useState<boolean>(true);

  // Non-discrimination policy modal states (1:1 with Screenshots 1 & 2)

  // Start with the live campaign list so the real run data is visible immediately.
  const viewEmptyState = false;

  // Toggles for on/off states
  const [campaignToggles, setCampaignToggles] = useState<Record<string, boolean>>({});

  // Table selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [showScoreDropdown, setShowScoreDropdown] = useState(false);
  const [showDateDropdown, setShowDateDropdown] = useState(false);

  // Editable lists
  const [campaignsList, setCampaignsList] = useState<CampaignItem[]>(INITIAL_CAMPAIGNS);

  const rangeEndAt = data.window.endAt || selectedRun?.virtualTime || "";
  const rangeStartAt = data.window.startAt || (rangeEndAt ? new Date(Date.parse(rangeEndAt) - rangeDays * 86_400_000).toISOString() : "");
  const selectedDateRange = `Last ${rangeDays} days: ${shortRangeDate(rangeStartAt)} - ${shortRangeDate(rangeEndAt)}`;

  const fetchCampaigns = useCallback(async () => {
    if (!runId) return;
    setIsRefreshing(true);
    try {
      const next = await api<SimulatorApiData>(`/api/dev/simulator/campaigns/${encodeURIComponent(campaignId)}?${q({ simulationRunId: runId, days: rangeDays })}`);
      const mapped = toAdsData(next, rangeDays);
      setData(mapped);
      setDetail(next);
      const rows = toCampaignItems(mapped);
      setCampaignsList(rows);
      setCampaignToggles(Object.fromEntries(rows.map((campaign) => [campaign.id, campaign.status === "active"])));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ads data is unavailable");
    } finally {
      setIsRefreshing(false);
    }
  }, [campaignId, rangeDays, runId]);

  useEffect(() => {
    if (!loaded || !runId) return;
    const initialFetch = setTimeout(() => { void fetchCampaigns(); }, 0);
    const t = setInterval(() => { void fetchCampaigns(); }, 15_000);
    return () => {
      clearTimeout(initialFetch);
      clearInterval(t);
    };
  }, [fetchCampaigns, loaded, runId]);

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  // Filtered & Sorted Campaigns
  const filteredCampaigns = useMemo(() => {
    let list = [...campaignsList];

    // Filter preset
    if (filterPreset === "delivery") {
      list = list.filter((c) => c.amountSpent > 0 || c.reach > 0);
    } else if (filterPreset === "actions") {
      list = list.filter((c) => data.events.some(e=>e.payload.campaignId===c.id));
    } else if (filterPreset === "active") {
      list = list.filter((c) => campaignToggles[c.id] !== false);
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.subtitle.toLowerCase().includes(q));
    }

    // Sort
    list.sort((a, b) => {
      const vA = (a as unknown as Record<string, unknown>)[sortField] ?? 0;
      const vB = (b as unknown as Record<string, unknown>)[sortField] ?? 0;
      if (typeof vA === "string") {
        return sortAsc
          ? (vA as string).localeCompare(vB as string)
          : (vB as string).localeCompare(vA as string);
      }
      return sortAsc ? (vA as number) - (vB as number) : (vB as number) - (vA as number);
    });

    return list;
  }, [campaignsList, filterPreset, searchQuery, sortField, sortAsc, campaignToggles, data.events]);

  // Dynamic Totals Calculation for Campaigns
  const campaignTotals = useMemo(() => {
    const totalSpent = filteredCampaigns.reduce((acc, c) => acc + c.amountSpent, 0);
    const totalReach = filteredCampaigns.reduce((acc, c) => acc + c.reach, 0);
    const totalTickets = filteredCampaigns.reduce((acc, c) => acc + c.tickets, 0);
    const totalPurchases = filteredCampaigns.reduce((acc, c) => acc + c.coursePurchases, 0);
    const totalConversionVal = filteredCampaigns.reduce((acc, c) => acc + c.conversionValue, 0);
    const costPerTicket = totalTickets > 0 ? Math.round(totalSpent / totalTickets) : 0;
    const costPerPurchase = totalPurchases > 0 ? Math.round(totalSpent / totalPurchases) : 0;
    const avgRoas = totalSpent > 0 ? +(totalConversionVal / totalSpent).toFixed(2) : 0;

    return {
      totalSpent,
      totalReach,
      totalTickets,
      totalPurchases,
      totalConversionVal,
      costPerTicket,
      costPerPurchase,
      avgRoas
    };
  }, [filteredCampaigns]);

  const openApprovals = () => router.push(withRun('/dashboard/approvals'));


  const handleExportCSV = () => {
    if(activeTab!=="campaigns")return;
    const rows = [
      ["ID","Name","Daily Budget (GBP)","Spend (GBP)","Impressions","Clicks","Attributed orders","Revenue (GBP)","CTR","ROAS"],
      ...filteredCampaigns.map(c=>[c.id,c.name,(c.budgetMinor/100).toFixed(2),(c.amountSpent/100).toFixed(2),String(c.reach),String(c.clicks),String(c.coursePurchases),(c.conversionValue/100).toFixed(2),c.ctr===null?'':String(c.ctr),c.amountSpent?String(c.roas):''])
    ];
    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.map(value => JSON.stringify(/^[=+@-]/.test(value) ? "\'" + value : value)).join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `meta_ads_${activeTab}_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!loaded) {
    return <div data-meta-copy-page className="h-screen flex items-center justify-center bg-[#f3f4f8] text-sm text-[#65676b]">Loading simulation…</div>;
  }
  if (unavailable || !runId) {
    return <div data-meta-copy-page className="h-screen flex flex-col items-center justify-center gap-3 bg-[#f3f4f8] text-sm text-[#65676b]"><strong className="text-[#1c2b33]">No simulation run is available</strong><span>Start a run from the Normal dashboard, then reopen Ads Manager.</span><a className="text-[#0a66c2] font-semibold" href={withRun("/dashboard")}>Return to Normal</a></div>;
  }

  return (
    <div
      data-meta-copy-page
      className="flex h-screen text-[#1c2b33] antialiased overflow-hidden select-none"
      style={{
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        background: "linear-gradient(100deg, #f6f2fb 0%, #efedf8 40%, #e9eef8 72%, #e6f2ee 100%)",
      }}
    >
      {/* Left rail: Meta logo on top, then the Ads Manager tools (full height, white) */}
      <aside className="w-[48px] bg-white border-r border-[#dde4ee] flex flex-col items-center flex-shrink-0 z-20 tracking-[-0.2px]">
        <div className="h-[46px] flex items-center justify-center" title="Meta">
          <svg className="w-[24px] h-[24px] fill-[#0064e0]" viewBox="0 0 24 24">
            <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z" />
          </svg>
        </div>

        <button
          className="relative mt-[14px] w-[34px] h-[34px] flex items-center justify-center text-[#1c2b33] rounded-[6px] hover:bg-[#f2f4f7] cursor-pointer"
          onClick={() => router.push(withRun("/dashboard/activity"))} title="Normal activity"
        >
          <Bell className="w-[20px] h-[20px] stroke-[1.75]" />
        </button>

        <div className="w-[24px] h-px bg-[#dadde1] mt-[15px] mb-[11px]" />

        {[
          { icon: Gauge, title: "Account overview" },
          { icon: Table2, title: "Campaigns", active: true },
          { icon: Files, title: "Reports" },
          { icon: Users, title: "Audiences" },
          { icon: Megaphone, title: "Advertising settings" },
          { icon: CreditCard, title: "Billing & Payments" },
          { icon: Workflow, title: "Events Manager" },
          { icon: Menu, title: "All tools" },
        ].map(({ icon: Icon, title, active }) => (
          <button disabled
            key={title}
            title={title}
            className={`w-[34px] h-[34px] my-px flex items-center justify-center rounded-[6px] cursor-pointer transition-colors ${
              active ? "bg-[#dfeefc] text-[#0a66c2]" : "text-[#1c2b33] hover:bg-[#f2f4f7]"
            }`}
          >
            <Icon className="w-[20px] h-[20px] stroke-[1.75]" />
          </button>
        ))}

        <div className="mt-auto flex flex-col items-center pb-[7px]">
          <div className="w-[24px] h-px bg-[#dadde1] mb-[8px]" />
          {[
            { icon: HelpCircle, title: "Help" },
            { icon: Settings, title: "Settings" },
            { icon: Search, title: "Search" },
            { icon: Bug, title: "Report a problem" },
          ].map(({ icon: Icon, title }) => (
            <button disabled key={title} title={title} className="w-[34px] h-[30px] flex items-center justify-center text-[#1c2b33] rounded-[6px] hover:bg-[#f2f4f7] cursor-pointer">
              <Icon className="w-[18px] h-[18px] stroke-[1.75]" />
            </button>
          ))}
        </div>
      </aside>

      {/* Middle column: header on the page gradient, then the content panel */}
      <div className="flex-1 flex flex-col min-w-0 tracking-[-0.2px]">
      <header className="h-[48px] pl-[10px] pr-[7px] flex items-center justify-between gap-3 flex-shrink-0 relative z-30">
        <div className="flex items-center min-w-0">
          <a className="text-xs text-blue-700 mr-3" href={withRun("/dashboard")}>← Normal</a><h1 className="text-[15px] font-bold text-[#1c2b33] flex-shrink-0">Campaigns</h1>

          {/* Account selector */}
          <div className="relative ml-[12px] min-w-0">
            <button
              onClick={() => setShowAccountDropdown(!showAccountDropdown)}
              className="w-[253px] max-w-full h-[32px] flex items-center bg-white border border-[#cbd2d9] rounded-[6px] pl-[8px] pr-[10px] hover:bg-[#f7f8fa] cursor-pointer text-[12px] text-[#1c2b33]"
            >
              <span className="w-[26px] h-[26px] rounded-[4px] bg-[#e4e6eb] flex items-center justify-center flex-shrink-0">
                <User className="w-[15px] h-[15px] text-[#8a8d91] fill-[#8a8d91]" />
              </span>
              <span className="w-px h-[18px] bg-[#dadde1] mx-[9px] flex-shrink-0" />
              <svg className="w-[13px] h-[13px] flex-shrink-0 mr-[8px]" viewBox="0 0 14 14" aria-hidden="true">
                <rect x="1" y="2" width="12" height="10" rx="2" fill="#1c2b33" />
                <rect x="3.5" y="5" width="3" height="4" rx="0.6" fill="#fff" />
                <rect x="7.5" y="5.6" width="3" height="1" rx="0.5" fill="#fff" />
                <rect x="7.5" y="7.4" width="2" height="1" rx="0.5" fill="#fff" />
              </svg>
              <span className="flex-1 min-w-0 truncate text-left">Nike Demo Account · {runId ?? "No run selected"}</span>
              <Caret className="w-[10px] h-[10px] ml-[6px] flex-shrink-0" />
            </button>

            {showAccountDropdown && (
              <div className="absolute top-[36px] left-0 w-64 bg-white border border-[#ccd0d5] rounded-[6px] shadow-lg z-50 py-1 text-xs">
                <div className="px-3 py-1.5 text-zinc-500 font-bold uppercase tracking-wider text-[10px]">
                  Switch simulation run
                </div>
                {runs.map((run) => (
                  <button
                    key={run.simulationRunId}
                    onClick={() => {
                      setRun(run.simulationRunId);
                      setShowAccountDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between font-medium text-[#1c1e21]"
                  >
                    <div className="flex items-center gap-2">
                      <User className="w-2.5 h-2.5 text-zinc-600" />
                      <span>{run.simulationRunId} · seed {run.seed}</span>
                    </div>
                    {runId === run.simulationRunId && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Opportunity score */}
          <div className="relative ml-[17px] flex-shrink-0 hidden lg:block">
            <button
              onClick={() => setShowScoreDropdown(!showScoreDropdown)}
              className="flex items-center h-[32px] rounded-[6px] cursor-pointer text-[12px] font-medium text-[#1c2b33] hover:bg-white/60 pr-1"
            >
            <OpportunityGauge score={selectedRun?.seed ?? 0} />
              <span className="ml-[8px]">Run seed</span>
              <Caret className="w-[10px] h-[10px] ml-[9px]" />
            </button>

            {showScoreDropdown && (
              <div className="absolute top-[36px] left-0 w-80 bg-white border border-[#ccd0d5] rounded-lg shadow-xl z-50 p-4 text-xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-[#1c1e21]">Selected run</span>
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">Seed {selectedRun?.seed ?? "—"}</span>
                </div>
                <p className="text-[#65676b]">
                  Campaign performance and agent actions below are read from this simulation run.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center text-[12px] flex-shrink-0">
          <span className="text-[#1c2b33] hidden xl:inline">Updated just now</span>
          <button
            onClick={fetchCampaigns}
            disabled={isRefreshing}
            className="ml-[14px] w-[34px] h-[30px] flex items-center justify-center bg-white border border-[#cbd2d9] rounded-[6px] text-[#1c2b33] hover:bg-[#f7f8fa] cursor-pointer"
            title="Refresh campaigns"
          >
            <RefreshCw className={`w-[16px] h-[16px] stroke-[1.75] ${isRefreshing ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={openApprovals}
            className="ml-[7px] h-[30px] px-[13px] bg-white text-[#0064e0] border border-[#cbd2d9] font-semibold text-[12px] rounded-[6px] cursor-not-allowed"
          >
            Review approvals
          </button>

          <button
            onClick={() => setShowAuditDrawer(!showAuditDrawer)}
            className="ml-[8px] w-[34px] h-[30px] flex items-center justify-center bg-white border border-[#cbd2d9] rounded-[6px] text-[#1c2b33] hover:bg-[#f7f8fa] cursor-pointer"
            title="More Options / Audit Log"
          >
            <MoreHorizontal className="w-[16px] h-[16px]" />
          </button>

          {/* Profile: generic person avatar with the Facebook badge */}
          <div className="relative ml-[7px]">
            <button
              disabled title="This is an unaffiliated simulation, not a signed-in Meta account"
              className="relative w-[30px] h-[30px] rounded-full bg-[#e4e6eb] flex items-center justify-center cursor-pointer"
              aria-label="Account profile"
            >
              <User className="w-[18px] h-[18px] text-[#8a8d91] fill-[#8a8d91]" />
              <span className="absolute -bottom-[1px] -right-[2px] w-[12px] h-[12px] rounded-full bg-[#0866ff] border border-white flex items-center justify-center text-white text-[8px] font-bold leading-none">
                f
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Content panel */}
      <div className="flex-1 flex flex-col min-h-0 ml-[6px] mr-[6px] mb-[6px] bg-[#f3f4f8] rounded-[8px] overflow-hidden">
        {/* Filter presets */}
        <div className="h-[43px] pt-[8px] px-[7px] flex items-start justify-between flex-shrink-0">
          <div className="flex items-center gap-[7px]">
            {[
              { label: "All ads", icon: null, preset: "all" as const },
              { label: "Actions", icon: CircleArrowUp, preset: "actions" as const },
              { label: "Active ads", icon: Navigation, preset: "active" as const },
              { label: "Had delivery", icon: MailOpen, preset: "delivery" as const },
            ].map(({ label, icon: Icon, preset }) => (
              <button
                key={label}
                onClick={()=>setFilterPreset(preset)}
                className={`h-[35px] px-[11px] flex items-center gap-[8px] rounded-[6px] border text-[12px] font-semibold cursor-pointer ${
                  filterPreset===preset ? "bg-white border-[#7ea8dd] text-[#0a66c2]" : "bg-white border-[#cbd2d9] text-[#1c2b33] hover:bg-[#f7f8fa]"
                }`}
              >
                {Icon ? <Icon className="w-[16px] h-[16px] stroke-[1.75]" /> : <Folder className="w-[16px] h-[16px] fill-[#0a66c2] text-[#0a66c2]" />}
                <span>{label}</span>
              </button>
            ))}
            <button disabled title="Not supported in this simulation" className="h-[35px] ml-[11px] flex items-center gap-[7px] text-[12px] font-semibold text-[#1c2b33] cursor-pointer hover:underline">
              <Plus className="w-[16px] h-[16px] stroke-[1.75]" />
              <span>See more</span>
            </button>
          </div>

          <div className="flex items-center gap-[4px]">
            <button
              disabled
              className="h-[35px] px-[12px] bg-white border border-[#cbd2d9] rounded-[6px] text-[12px] font-semibold text-[#1c2b33] hover:bg-[#f7f8fa] cursor-pointer"
              title="Saved views are not supported"
            >
              Create a view
            </button>
            <button
              disabled
              className="w-[34px] h-[35px] flex items-center justify-center bg-white border border-[#cbd2d9] rounded-[6px] text-[#1c2b33] hover:bg-[#f7f8fa] cursor-pointer"
              title="Saved views are not supported"
            >
              <Settings2 className="w-[16px] h-[16px] stroke-[1.75]" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-[7px] mt-[7px] flex-shrink-0">
          <div className="relative w-full">
            <input
              type="text"
              placeholder="Describe what you're looking for"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-[31px] bg-white text-[12px] text-[#1c2b33] rounded-[6px] pl-[35px] pr-8 border border-transparent focus:border-[#0a66c2] outline-none placeholder:text-[#65676b]"
            />
            <AISearchIcon className="w-[15px] h-[15px] text-[#1c2b33] absolute left-[11px] top-1/2 -translate-y-1/2" />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-black cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Tabs + date range */}
        <div className="h-[36px] mt-[8px] px-[7px] flex items-start justify-between flex-shrink-0">
          <div className="flex items-end h-full gap-[7px]">
            {([
              { id: "campaigns", label: "Campaigns" },
              { id: "ad_sets", label: "Ad sets" },
              { id: "ads", label: "Ads" },
            ] as const).map(({ id, label }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => {
                    setActiveTab(id);
                    setSelectedIds(new Set());
                  }}
                  className={`w-[169px] h-[36px] pl-[11px] flex items-center gap-[7px] rounded-t-[8px] text-[13.5px] font-bold cursor-pointer transition-colors ${
                    active ? "bg-white text-[#0a66c2]" : "bg-[#eceef2] text-[#1c2b33] hover:bg-[#e6e9ee]"
                  }`}
                >
                  {id === "campaigns" ? (
                    <CampaignFolderIcon />
                  ) : id === "ad_sets" ? (
                    <LayoutGrid className="w-[18px] h-[18px] stroke-[1.75]" />
                  ) : (
                    <PanelTop className="w-[18px] h-[18px] stroke-[1.75]" />
                  )}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowDateDropdown(!showDateDropdown)}
              className="h-[29px] min-w-[284px] px-[10px] flex items-center gap-[7px] whitespace-nowrap text-[12px] font-medium text-[#1c2b33] border border-[#cbd2d9] rounded-[6px] hover:bg-white cursor-pointer"
            >
              <Calendar className="w-[15px] h-[15px] stroke-[1.75]" />
              <span className="flex-1 text-left truncate">{selectedDateRange}</span>
              <Caret className="w-[10px] h-[10px]" />
            </button>

            {showDateDropdown && (
              <div className="absolute right-0 top-8 w-64 bg-white border border-[#ccd0d5] rounded shadow-lg z-50 py-1 text-xs">
                {[30, 14, 7].map((days) => {
                  const label = `Last ${days} days`;
                  return (
                  <button
                    key={days}
                    onClick={() => {
                      setRangeDays(days);
                      setShowDateDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between font-medium text-[#1c1e21]"
                  >
                    <span>{label}</span>
                    {rangeDays === days && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                );})}
              </div>
            )}
          </div>
        </div>

        {showHistory&&detail&&<CampaignHistory name={data.campaigns.find(c=>c.campaignId===campaignId)?.name??campaignId} data={detail.daily} comparison={detail.comparison.find(c=>c.campaignId===campaignId)} />}

        {/* Action toolbar (white strip joined to the active tab) */}
        <div className="h-[44px] px-[7px] bg-white flex items-center justify-between gap-[7px] text-[12px] whitespace-nowrap flex-shrink-0 overflow-x-auto">
          <div className="flex items-center gap-[7px] flex-shrink-0">
            <button
              disabled title="Campaign creation is not supported"
              className="h-[30px] w-[80px] bg-[#00704d] hover:bg-[#005f41] text-white font-semibold rounded-[6px] flex items-center justify-center gap-[7px] transition-colors cursor-pointer"
            >
              <Plus className="w-[16px] h-[16px] stroke-[2]" />
              <span>Create</span>
            </button>

            <button
              disabled
              className="h-[30px] px-[10px] flex items-center gap-[7px] rounded-[6px] border border-[#e1e4e8] bg-white font-semibold text-[#1c2b33] disabled:text-[#bcc0c4] enabled:hover:bg-[#f7f8fa] enabled:border-[#cbd2d9] cursor-pointer disabled:cursor-default"
              title="Duplicate selected rows"
            >
              <Copy className="w-[15px] h-[15px] stroke-[1.75]" />
              <span>Duplicate{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</span>
            </button>

            <button
              onClick={openApprovals}
              disabled={selectedIds.size === 0}
              className={`h-[30px] px-[10px] flex items-center gap-[7px] rounded-[6px] border bg-white font-semibold ${
                selectedIds.size > 0 ? "border-[#cbd2d9] text-[#1c2b33] hover:bg-[#f7f8fa] cursor-pointer" : "border-[#e1e4e8] text-[#bcc0c4] cursor-default"
              }`}
              title="Review approved changes"
            >
              <Pencil className="w-[15px] h-[15px] stroke-[1.75]" />
              <span>Approvals</span>
            </button>

            <span className="w-px h-[22px] bg-[#dadde1] mx-[1px]" />

            <button
              onClick={() => router.push(withRun("/dashboard/signals"))}
              className="h-[30px] px-[10px] flex items-center gap-[7px] rounded-[6px] border border-[#cbd2d9] bg-white font-semibold text-[#1c2b33] hover:bg-[#f7f8fa] cursor-pointer"
              title="Run AI Optimisation Analysis"
            >
              <AnalysePetals />
              <span>Analyse</span>
            </button>

            <button
              disabled
              className="h-[30px] px-[10px] flex items-center gap-[7px] rounded-[6px] border border-[#cbd2d9] bg-white font-semibold text-[#1c2b33] hover:bg-[#f7f8fa] cursor-pointer"
              title="A/B Test"
            >
              <FlaskConical className="w-[15px] h-[15px] stroke-[1.75]" />
              <span>A/B test</span>
            </button>

            <button disabled title="Not supported in this simulation" className="h-[30px] px-[7px] ml-[7px] flex items-center gap-[9px] font-semibold text-[#1c2b33] rounded-[6px] hover:bg-[#f2f4f7] cursor-pointer">
              <span>More</span>
              <Caret className="w-[10px] h-[10px]" />
            </button>
          </div>

          <div className="flex items-center justify-end gap-[7px] flex-shrink-0">
            {[
              { label: "Columns", icon: Columns3 },
              { label: "Breakdown", icon: AlignLeft },
              { label: "Groups", icon: Layers },
            ].map(({ label, icon: Icon }) => (
              <button disabled title="Not supported in this simulation" key={label} className={`h-[30px] pl-[10px] pr-[11px] ${label === "Columns" ? "hidden xl:flex" : "flex"} items-center gap-[7px] rounded-[6px] border border-[#cbd2d9] bg-white font-semibold text-[#1c2b33] hover:bg-[#f7f8fa] cursor-pointer`}>
                <Icon className="w-[15px] h-[15px] stroke-[1.75]" />
                <span>{label}</span>
                <Caret className="w-[10px] h-[10px] ml-[5px]" />
              </button>
            ))}

            <button disabled className="h-[30px] w-[54px] hidden xl:flex items-center justify-center gap-[9px] rounded-[6px] border border-[#cbd2d9] bg-white text-[#1c2b33] hover:bg-[#f7f8fa] cursor-pointer" title="Reports">
              <ScrollText className="w-[15px] h-[15px] stroke-[1.75]" />
              <Caret className="w-[10px] h-[10px]" />
            </button>

            <div className="h-[30px] flex rounded-[6px] border border-[#cbd2d9] bg-white text-[#1c2b33] overflow-hidden">
              <button disabled={activeTab!=="campaigns"} onClick={handleExportCSV} className="w-[33px] flex items-center justify-center hover:bg-[#f7f8fa] cursor-pointer" title="Export Report to CSV">
                <Download className="w-[15px] h-[15px] stroke-[1.75]" />
              </button>
              <span className="w-px bg-[#e1e4e8]" />
              <button disabled className="w-[32px] flex items-center justify-center hover:bg-[#f7f8fa] cursor-pointer" title="Export options">
                <Caret className="w-[10px] h-[10px]" />
              </button>
            </div>

            <button onClick={()=>setShowHistory(v=>!v)} className="w-[34px] h-[30px] flex items-center justify-center rounded-[6px] border border-[#cbd2d9] bg-white text-[#1c2b33] hover:bg-[#f7f8fa] cursor-pointer" title="View charts">
              <SquareActivity className="w-[15px] h-[15px] stroke-[1.75]" />
            </button>
          </div>
        </div>

        {/* Audited Changes Log Drawer */}
        {showAuditDrawer && (
          <div className="bg-[#1c2b36] text-white p-4 border-b border-zinc-800 text-xs space-y-2 max-h-48 overflow-y-auto">
            <div className="flex justify-between items-center font-bold text-zinc-300">
              <span>Normal Operations Audit History</span>
              <button onClick={() => setShowAuditDrawer(false)} className="text-zinc-400 hover:text-white">
                ✕ Close
              </button>
            </div>
            {data.events.length === 0 ? (
              <p className="text-zinc-400">No agent actions recorded yet.</p>
            ) : (
              data.events.map((e) => (
                <div key={e.eventId} className="bg-zinc-800/90 p-2.5 rounded border border-zinc-700 flex justify-between items-center font-mono">
                  <div>
                    <span className="text-emerald-400 font-bold">{String(e.payload.agent ?? "Marketing agent")}</span>
                    <span className="text-zinc-400"> · {new Date(e.occurredAt).toLocaleString("en-GB")}</span>
                    <p className="text-zinc-200 mt-0.5">
                      Budget modified: {money(Number(e.payload.previousBudgetMinor), "GBP")} → {money(Number(e.payload.newBudgetMinor), "GBP")}/day
                    </p>
                  </div>
                  <span className="text-[11px] text-zinc-400">{String(e.payload.planId)}</span>
                </div>
              ))
            )}
          </div>
        )}

        {/* 3. The Performance Data Table (100% Functional Sorting & Interaction) */}
        <div className="min-w-0 flex-1 overflow-auto bg-[#e9eaec]">
          {error && (
            <div className="m-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-xs">
              {error}
            </div>
          )}

          {/* TAB 1: CAMPAIGNS */}
          {activeTab === "campaigns" && (
            <table className="w-full min-w-[1950px] text-left text-[12px] border-collapse table-fixed">
              <thead className="bg-white sticky top-0 z-20 border-y border-[#dcdddf] text-[12px] font-semibold text-[#1c2b33]">
                <tr className="h-[40px]">
                  <th className="sticky left-0 z-30 w-[40px] border-r border-[#e4e6eb] bg-white text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === filteredCampaigns.length && filteredCampaigns.length > 0}
                      onChange={() => {
                        if (selectedIds.size === filteredCampaigns.length) setSelectedIds(new Set());
                        else setSelectedIds(new Set(filteredCampaigns.map((c) => c.id)));
                      }}
                      className="w-[20px] h-[20px] align-middle rounded-[4px] accent-[#0a66c2] cursor-pointer"
                    />
                  </th>
                  {[
                    { label: "Off/On", width: "w-[80px] sticky left-[40px] z-30 bg-white", sort: "status" },
                    { label: "Campaign", width: "w-[291px] sticky left-[120px] z-30 bg-white", sort: "name", caret: true },
                    { label: "Delivery", width: "w-[135px]", sort: "delivery", caret: true, active: true },
                    { label: "Actions", width: "w-[169px]", caret: true },
                    { label: "Attribution setting", width: "w-[102px]", caret: true, wrap: true },
                    { label: "Orders", width: "w-[124px]", sort: "coursePurchases", caret: true },
                    { label: "Cost per result", width: "w-[145px]", sort: "costPerCoursePurchase", caret: true },
                    { label: "Spend", width: "w-[110px]", sort: "amountSpent" },
                    { label: "Impressions", width: "w-[110px]", sort: "reach" },
                    { label: "Clicks", width: "w-[90px]", sort: "clicks" },
                    { label: "CTR", width: "w-[90px]", sort: "ctr" },
                    { label: "Revenue", width: "w-[110px]", sort: "conversionValue" },
                    { label: "ROAS", width: "w-[90px]", sort: "roas" },
                    { label: "Budget", width: "w-[140px] sticky right-0 bg-white z-20", sort: "budgetMinor" },
                  ].map(({ label, width, sort, caret, active, wrap }) => (
                    <th
                      key={label}
                      onClick={sort ? () => handleSort(sort) : undefined}
                      className={`${width} pl-[9px] pr-[8px] border-r border-[#e4e6eb] last:border-r-0 font-semibold ${sort ? "cursor-pointer hover:bg-[#f7f8fa]" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-1 min-w-0">
                        <span className={`flex items-center min-w-0 ${active ? "text-[#0a66c2]" : ""}`}>
                          <span className={wrap ? "leading-[15px] whitespace-normal" : "truncate"}>{label}</span>
                          {active ? (
                            <ArrowDown className="w-[14px] h-[14px] ml-[5px] flex-shrink-0 stroke-[2]" />
                          ) : sort ? (
                            <ArrowUpDown className="w-[14px] h-[14px] ml-[4px] flex-shrink-0 stroke-[1.75]" />
                          ) : null}
                        </span>
                        {caret && <Caret className="w-[9px] h-[9px] flex-shrink-0 text-[#1c2b33]" />}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-[#dadde1]">
                {viewEmptyState || filteredCampaigns.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="pt-[51px] pb-16 text-center bg-[#e9eaec] border-none align-top">
                      <div className="flex flex-col items-center justify-center">
                        <div className="w-[38px] h-[38px] rounded-full bg-[#8d95a0] text-white flex items-center justify-center">
                          <Plus className="w-[22px] h-[22px] stroke-[3]" />
                        </div>
                        <h3 className="mt-[15px] font-bold text-[13.5px] leading-[18px] text-[#1c2b33]">No results found</h3>
                        <p className="mt-[3px] text-[11.75px] leading-[16px] text-[#65676b]">No campaign records are available for this run and filter.</p>
                        <button
                          disabled title="Campaign creation is not supported"
                          className="mt-[11px] h-[30px] px-[12px] border border-[#bcc0c4] bg-[#eceef0] hover:bg-[#e2e4e8] text-[#1c2b33] font-semibold text-[12px] rounded-[6px] transition-colors cursor-pointer"
                        >
                          Create ad
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredCampaigns.map((camp) => {
                    const isChecked = selectedIds.has(camp.id);
                    const isToggleOn = campaignToggles[camp.id] ?? true;
                    const pinnedRowBackground = isChecked || camp.id === campaignId
                      ? "bg-blue-50/50"
                      : "bg-[#e9eaec] group-hover:bg-[#f2f4f8]";


                    return (
                      <tr
                        data-testid={`campaign-${camp.id}`}
                        key={camp.id}
                        className={`hover:bg-[#f2f4f8] transition-colors group ${
                          isChecked || camp.id === campaignId ? "bg-blue-50/50" : ""
                        }`}
                      >
                        {/* Checkbox */}
                        <td className={`sticky left-0 z-10 px-2 py-2 text-center border-r border-[#e4e6eb] ${pinnedRowBackground}`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectRow(camp.id)}
                            className="rounded accent-[#0064e0] cursor-pointer scale-90"
                          />
                        </td>

                        {/* On/Off Toggle */}
                        <td className={`sticky left-[40px] z-10 px-2 py-2 border-r border-[#e4e6eb] ${pinnedRowBackground}`}>
                          <button
                            disabled title="Status changes are not supported"
                            className={`w-8 h-4 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                              isToggleOn ? "bg-[#0064e0]" : "bg-[#8a8d91]"
                            }`}
                          >
                            <div
                              className={`bg-white w-3 h-3 rounded-full shadow-md transform transition-transform ${
                                isToggleOn ? "translate-x-3.5" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </td>

                        {/* Campaign Name */}
                        <td className={`sticky left-[120px] z-10 px-2 py-2 border-r border-[#e4e6eb] font-medium text-[#1c1e21] ${pinnedRowBackground}`}>
                          <span
                            onClick={() => {
                              router.push(withRun(`/dashboard/campaigns/${encodeURIComponent(camp.id)}`));
                            }}
                            className="hover:underline cursor-pointer font-semibold block text-[12px]"
                          >
                            {camp.name}
                          </span>
                          <span className="text-[11px] text-[#65676b] block">{camp.subtitle}</span>
                        </td>

                        {/* Delivery */}
                        <td className="px-2 py-2 border-r border-[#e4e6eb] text-[#0064e0] font-medium text-[12px]">
                          <span className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${isToggleOn ? "bg-emerald-500" : "bg-zinc-400"}`} />
                            <span>{isToggleOn ? "Active" : "Off"}</span>
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-2 py-2 border-r border-[#e4e6eb] text-[12px] text-[#65676b]">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                openApprovals();
                              }}
                              className="text-[#0064e0] hover:underline cursor-pointer"
                            >
                              Review
                            </button>
                            <span>·</span>
                            <button
                              disabled title="Duplication is not supported"
                              className="text-[#0064e0] hover:underline cursor-pointer"
                            >
                              Duplicate
                            </button>
                          </div>
                        </td>

                        {/* Attribution setting */}
                        <td className="px-2 py-2 border-r border-[#e4e6eb] text-[11px] text-[#65676b]">
                          <span>Simulation attribution</span>
                        </td>

                        {/* Results */}
                        <td className="px-2 py-2 text-right border-r border-[#e4e6eb] font-semibold text-[#1c1e21]">
                          {camp.coursePurchases}
                        </td>

                        {/* Cost per result */}
                        <td className="px-2 py-2 text-right border-r border-[#e4e6eb] text-[#1c1e21]">
                          {camp.costPerCoursePurchase > 0 ? `£${(camp.costPerCoursePurchase / 100).toFixed(2)}` : "—"}
                        </td>

                        <td className="px-2 py-2 text-right border-r">{money(camp.amountSpent,'GBP')}</td>
                        <td className="px-2 py-2 text-right border-r">{camp.reach.toLocaleString('en-GB')}</td>
                        <td className="px-2 py-2 text-right border-r">{camp.clicks.toLocaleString('en-GB')}</td>
                        <td className="px-2 py-2 text-right border-r">{camp.ctr===null?'—':`${(camp.ctr*100).toFixed(2)}%`}</td>
                        <td className="px-2 py-2 text-right border-r">{money(camp.conversionValue,'GBP')}</td>
                        <td className="px-2 py-2 text-right border-r">{camp.amountSpent?`${camp.roas.toFixed(2)}×`:'—'}</td>
                        {/* Approved budget is always read from MongoDB. */}
                        <td className="px-2 py-2 text-right font-medium text-[#1c1e21] sticky right-0 z-10 bg-white"><button onClick={openApprovals} title="Review budget changes in Approvals" className="text-[#0064e0] font-semibold">{money(camp.budgetMinor, "GBP")} / day</button></td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {/* Dynamic Summary / Totals Row */}
              {!viewEmptyState && showResultsBar && (
                <tfoot className="bg-white border-t text-xs"><tr><td colSpan={15} className="px-4 py-3">{filteredCampaigns.length} campaigns · Spend {money(campaignTotals.totalSpent,'GBP')} · {campaignTotals.totalReach.toLocaleString('en-GB')} impressions · {campaignTotals.totalPurchases} orders · Revenue {money(campaignTotals.totalConversionVal,'GBP')} · {campaignTotals.totalSpent?`${campaignTotals.avgRoas.toFixed(2)}× ROAS`:'ROAS unavailable'}</td></tr></tfoot>
              )}
            </table>
          )}

          {activeTab === "ad_sets" && (
            <div className="m-4 rounded border border-[#dadde1] bg-white p-6 text-center text-[12px] text-[#65676b]">
              Ad set level records are not included in this simulation run. Campaign level performance is available in the Campaigns tab.
            </div>
          )}
          {activeTab === "ads" && (
            <div className="m-4 rounded border border-[#dadde1] bg-white p-6 text-center text-[12px] text-[#65676b]">
              Individual ad records are not included in this simulation run. Campaign level performance is available in the Campaigns tab.
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}

function ScopedMeta({campaignId}:{campaignId:string}){const {runId}=useRun();return <MetaAdsManager key={`${runId}:${campaignId}`} campaignId={campaignId}/>;}

export function MetaAdsManagerPage({ campaignId }: { campaignId: string }) {
  return (
    <Suspense fallback={<div data-meta-copy-page className="h-screen bg-[#f3f4f8] p-8"><PageSkeleton variant="campaign" label="Loading campaign workspace" /></div>}>
      <RunProvider>
        <ScopedMeta campaignId={campaignId} />
      </RunProvider>
    </Suspense>
  );
}
