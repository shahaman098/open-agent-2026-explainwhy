"use client";

import {
Activity,
AlertTriangle,
ArrowDown,
ArrowUpDown,
BarChart3,
Bell,
Bot,
Calendar,
Check,
ChevronDown,
ChevronRight,
Eye,
FileText,
Globe,
Home,
Landmark,
Package,
PanelLeft,
Percent,
Plus,
RotateCcw,
Search,
Settings,
Sparkles,
Store,
Tag,
Truck,
Users,
X
} from "lucide-react";
import { useEffect,useMemo,useState } from "react";

// Official Shopify Shopping Bag SVG Logo (Authentic Brand Mark)
function ShopifyLogo({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 292"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M223.774 57.34c-.201-1.46-1.48-2.268-2.537-2.357-1.055-.088-23.383-1.743-23.383-1.743s-15.507-15.395-17.209-17.099c-1.703-1.703-5.029-1.185-6.32-.805-.19.056-3.388 1.043-8.678 2.68-5.18-14.906-14.322-28.604-30.405-28.604-.444 0-.901.018-1.358.044C129.31 3.407 123.644.779 118.75.779c-37.465 0-55.364 46.835-60.976 70.635-14.558 4.511-24.9 7.718-26.221 8.133-8.126 2.549-8.383 2.805-9.45 10.462C21.3 95.806.038 260.235.038 260.235l165.678 31.042 89.77-19.42S223.973 58.8 223.775 57.34zM156.49 40.848l-14.019 4.339c.005-.988.01-1.96.01-3.023 0-9.264-1.286-16.723-3.349-22.636 8.287 1.04 13.806 10.469 17.358 21.32zm-27.638-19.483c2.304 5.773 3.802 14.058 3.802 25.238 0 .572-.005 1.095-.01 1.624-9.117 2.824-19.024 5.89-28.953 8.966 5.575-21.516 16.025-31.908 25.161-35.828zm-11.131-10.537c1.617 0 3.246.549 4.805 1.622-12.007 5.65-24.877 19.88-30.312 48.297l-22.886 7.088C75.694 46.16 90.81 10.828 117.72 10.828z"
        fill="#95BF46"
      />
      <path
        d="M221.237 54.983c-1.055-.088-23.383-1.743-23.383-1.743s-15.507-15.395-17.209-17.099c-.637-.634-1.496-.959-2.394-1.099l-12.527 256.233 89.762-19.418S223.972 58.8 223.774 57.34c-.201-1.46-1.48-2.268-2.537-2.357"
        fill="#5E8E3E"
      />
      <path
        d="M167.332 79.52l-9.027 197.838 89.762-19.418S223.972 58.8 223.774 57.34c-.201-1.46-1.48-2.268-2.537-2.357-1.055-.088-23.383-1.743-23.383-1.743s-15.507-15.395-17.209-17.099c-.637-.634-1.496-.959-2.394-1.099l-11.919 44.478z"
        fill="#5E8E3E"
      />
      <path
        d="M117.72 26.657c-2.822 0-5.617.51-8.22 1.488C103.88 10.638 89.317 0 71.394 0 45.474 0 29.8 24.385 24.58 46.54c-1.63 6.924-2.32 13.914-2.07 20.91-14.558 4.511-24.9 7.718-26.221 8.133-8.126 2.549-8.383 2.805-9.45 10.462C-14.28 95.806-35.542 260.235-35.542 260.235l165.678 31.042 89.77-19.42S-11.607 58.8-11.805 57.34c-.201-1.46-1.48-2.268-2.537-2.357-1.055-.088-23.383-1.743-23.383-1.743s-15.507-15.395-17.209-17.099c-1.703-1.703-5.029-1.185-6.32-.805-.19.056-3.388 1.043-8.678 2.68-3.08-8.86-7.85-17.2-14.37-24.32a48.7 48.7 0 0 0-3.34-3.04z"
        fill="#FFFFFF"
        opacity="0.25"
      />
      <path
        d="M136.275 106.82l-7.464 22.84s-7.14-3.73-15.684-3.73c-12.443 0-13.067 7.807-13.067 9.799 0 10.749 28.536 14.869 28.536 40.016 0 19.824-12.604 32.222-29.625 32.222-20.467 0-31.528-12.756-31.528-12.756l5.526-23.235s11.06 8.358 23.364 8.358c7.34 0 10.778-5.772 10.778-9.845 0-12.65-28.562-13.882-28.562-38.647 0-19.98 14.183-33.827 34.628-33.827 15.352 0 23.098 8.805 23.098 8.805z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

// Official Nike Swoosh Vector Mark
function NikeSwoosh({ className = "w-4 h-4 fill-current" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fillRule="evenodd"
        d="M21 8.719L7.836 14.303C6.74 14.768 5.818 15 5.075 15c-.836 0-1.445-.295-1.819-.884-.485-.76-.273-1.982.559-3.272.494-.754 1.122-1.446 1.734-2.108-.144.234-1.415 2.349-.025 3.345.275.2.666.298 1.147.298.386 0 .829-.063 1.316-.19L21 8.719z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// Nike UK Direct Product Catalog
const NIKE_PRODUCTS_DATA = [
  { id: "prod_1", title: "Nike Air Max 95 Big Bubble Premium", sku: "NK-AM95-BBP", status: "Active", inventory: "18 in stock", category: "Shoes > Sneakers", price: 174.99 },
  { id: "prod_2", title: "Nike Tiempo Maestro Elite", sku: "NK-TME-01", status: "Active", inventory: "4 in stock (Low)", category: "Shoes > Football", price: 229.99 },
  { id: "prod_3", title: "Nike Air Max Plus", sku: "NK-AMP-UB", status: "Active", inventory: "26 in stock", category: "Shoes > Lifestyle", price: 169.99 },
  { id: "prod_4", title: "Nike Court Vision Low", sku: "NK-CVL-WH", status: "Active", inventory: "52 in stock", category: "Shoes > Casual", price: 69.99 },
  { id: "prod_5", title: "Nike Lahar Low", sku: "NK-LL-WHT", status: "Active", inventory: "11 in stock", category: "Shoes > Boots", price: 129.99 },
  { id: "prod_6", title: "Jordan Spizike Low", sku: "JD-SPL-RED", status: "Active", inventory: "8 in stock", category: "Shoes > Jordan", price: 154.99 },
  { id: "prod_7", title: "Nike Mercurial Vapor 17 Elite", sku: "NK-MV17-EL", status: "Active", inventory: "15 in stock", category: "Shoes > Football", price: 239.99 },
  { id: "prod_8", title: "Nike Pegasus 41 Road Running", sku: "NK-PEG41-BK", status: "Active", inventory: "38 in stock", category: "Shoes > Running", price: 129.99 },
];

export type ShopifyOrder = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerLocation: string;
  total: number;
  currency: string;
  paymentStatus: "Paid" | "Pending" | "Refunded";
  fulfillmentStatus: "Fulfilled" | "Unfulfilled" | "Delayed";
  carrierTracking?: string;
  carrierName?: string;
  slaBreach?: boolean;
  promisedDate?: string;
  currentEstimatedDate?: string;
  orderDate: string;
  items: { name: string; quantity: number; price: number; sku: string }[];
  timeline: { time: string; event: string; status: "success" | "warning" | "error" | "info" }[];
};

// 100% Synthetic Mock Data (Zero real personal names/emails)
const SYNTHETIC_ORDERS: ShopifyOrder[] = [
  {
    id: "#1042",
    customerName: "Liam Cooper",
    customerEmail: "liam.cooper@example.co.uk",
    customerLocation: "24 Albion Street, Leeds, LS1 5ER",
    total: 174.99,
    currency: "GBP",
    paymentStatus: "Paid",
    fulfillmentStatus: "Delayed",
    carrierTracking: "GB3829104812",
    carrierName: "Royal Mail Tracked 48",
    slaBreach: true,
    promisedDate: "23 Oct 2026, 17:00",
    currentEstimatedDate: "25 Oct 2026, 14:00 (Delayed)",
    orderDate: "Today, 14:22",
    items: [
      { name: "Nike Air Max 90 UK Edition - Black / Wolf Grey (UK 9.5)", quantity: 1, price: 134.99, sku: "NK-AM90-BLK-95" },
      { name: "Nike Everyday Cushion Crew Socks (3 Pairs) - White (L)", quantity: 1, price: 17.99, sku: "NK-SCK-WHT-L" },
      { name: "Nike Pro 3\" Training Shorts - Black (S)", quantity: 1, price: 22.01, sku: "NK-PRO-SHT-S" }
    ],
    timeline: [
      { time: "Today, 14:22", event: "Order placed by Liam Cooper (£174.99)", status: "info" },
      { time: "Today, 14:23", event: "Payment confirmed via Apple Pay", status: "success" },
      { time: "Today, 15:10", event: "Dispatched from Northampton Distribution Hub", status: "success" },
      { time: "Today, 16:45", event: "Delayed at Royal Mail Leeds Sorting Center (Mechanical sorting failure)", status: "error" },
      { time: "Today, 17:05", event: "Normal Agent: Automated delivery notice email sent to customer with tracking update", status: "warning" }
    ]
  },
  {
    id: "#1041",
    customerName: "Elena Rostova",
    customerEmail: "elena.rostova@example.co.uk",
    customerLocation: "12 King Street, Manchester, M2 6AW",
    total: 229.99,
    currency: "GBP",
    paymentStatus: "Paid",
    fulfillmentStatus: "Delayed",
    carrierTracking: "GB3829104811",
    carrierName: "Royal Mail Tracked 48",
    slaBreach: true,
    promisedDate: "23 Oct 2026, 13:00",
    currentEstimatedDate: "25 Oct 2026, 11:30 (Delayed)",
    orderDate: "Today, 11:05",
    items: [
      { name: "Nike Phantom GX II Elite FG Football Boots - Sunset Tint (UK 8.5)", quantity: 1, price: 229.99, sku: "NK-PHM-ELT-85" }
    ],
    timeline: [
      { time: "Today, 11:05", event: "Order placed by Elena Rostova (£229.99)", status: "info" },
      { time: "Today, 11:06", event: "Payment verified via Visa Debit", status: "success" },
      { time: "Today, 12:30", event: "Dispatched from Northampton Logistics Depot", status: "success" },
      { time: "Today, 14:15", event: "Transit bottleneck identified at Leeds Mail Center", status: "error" },
      { time: "Today, 14:30", event: "Normal Agent: Delivery protection status active", status: "warning" }
    ]
  },
  {
    id: "#1040",
    customerName: "Chloe Bennett",
    customerEmail: "chloe.bennett@example.co.uk",
    customerLocation: "45 Oxford Street, London, W1D 2DZ",
    total: 109.99,
    currency: "GBP",
    paymentStatus: "Paid",
    fulfillmentStatus: "Delayed",
    carrierTracking: "GB3829104810",
    carrierName: "Royal Mail Tracked 48",
    slaBreach: true,
    promisedDate: "23 Oct 2026, 18:00",
    currentEstimatedDate: "25 Oct 2026, 15:00 (Delayed)",
    orderDate: "Today, 09:41",
    items: [
      { name: "Nike Air Force 1 '07 - Triple White (UK 9)", quantity: 1, price: 109.99, sku: "NK-AF1-WHT-9" }
    ],
    timeline: [
      { time: "Today, 09:41", event: "Order placed by Chloe Bennett (£109.99)", status: "info" },
      { time: "Today, 11:00", event: "Dispatched from Central Warehouse", status: "success" },
      { time: "Today, 15:30", event: "Sorting backlog detected at Northern Transit Hub", status: "error" }
    ]
  },
  {
    id: "#1039",
    customerName: "David Chen",
    customerEmail: "david.chen@example.co.uk",
    customerLocation: "8 Park Row, Bristol, BS1 5LJ",
    total: 32.99,
    currency: "GBP",
    paymentStatus: "Paid",
    fulfillmentStatus: "Delayed",
    carrierTracking: "GB3829104809",
    carrierName: "Royal Mail Tracked 48",
    slaBreach: true,
    promisedDate: "23 Oct 2026, 16:00",
    currentEstimatedDate: "25 Oct 2026, 12:00 (Delayed)",
    orderDate: "Yesterday, 21:15",
    items: [
      { name: "Nike Dri-FIT Running Headband & Wristband Set - Black", quantity: 1, price: 32.99, sku: "NK-ACC-HBD-BLK" }
    ],
    timeline: [
      { time: "Yesterday, 21:15", event: "Order placed by David Chen (£32.99)", status: "info" },
      { time: "Today, 08:30", event: "Processed at sorting terminal", status: "success" },
      { time: "Today, 13:40", event: "SLA window exceeded due to Leeds mechanical failure", status: "error" }
    ]
  },
  {
    id: "#1038",
    customerName: "Finley Hayes",
    customerEmail: "finley.hayes@example.co.uk",
    customerLocation: "19 New Street, Birmingham, B2 4RG",
    total: 134.99,
    currency: "GBP",
    paymentStatus: "Paid",
    fulfillmentStatus: "Delayed",
    carrierTracking: "GB3829104808",
    carrierName: "Royal Mail Tracked 48",
    slaBreach: true,
    promisedDate: "23 Oct 2026, 15:00",
    currentEstimatedDate: "25 Oct 2026, 10:00 (Delayed)",
    orderDate: "Yesterday, 17:30",
    items: [
      { name: "Nike Pegasus 41 Road Running Shoes - White / Pure Platinum (UK 10)", quantity: 1, price: 134.99, sku: "NK-PEG41-WHT-10" }
    ],
    timeline: [
      { time: "Yesterday, 17:30", event: "Order placed by Finley Hayes (£134.99)", status: "info" },
      { time: "Yesterday, 18:45", event: "Package sealed and labeled", status: "success" },
      { time: "Today, 14:00", event: "Carrier tracking alert: 24h regional network hold", status: "error" }
    ]
  },
  {
    id: "#1037",
    customerName: "Julian Brooks",
    customerEmail: "julian.brooks@example.co.uk",
    customerLocation: "77 Princes Street, Edinburgh, EH2 2ER",
    total: 99.99,
    currency: "GBP",
    paymentStatus: "Paid",
    fulfillmentStatus: "Fulfilled",
    orderDate: "Yesterday, 14:10",
    items: [
      { name: "Nike Dri-FIT Tech Fleece Full-Zip Hoodie - Dark Heather Grey (M)", quantity: 1, price: 99.99, sku: "NK-TCF-HOD-GRY-M" }
    ],
    timeline: [
      { time: "Yesterday, 14:10", event: "Order placed by Julian Brooks (£99.99)", status: "info" },
      { time: "Today, 10:15", event: "Delivered to Edinburgh address", status: "success" }
    ]
  },
  {
    id: "#1036",
    customerName: "Amara Patel",
    customerEmail: "amara.patel@example.co.uk",
    customerLocation: "33 Camden High Street, London, NW1 7JE",
    total: 54.99,
    currency: "GBP",
    paymentStatus: "Paid",
    fulfillmentStatus: "Fulfilled",
    orderDate: "22 Oct, 18:45",
    items: [
      { name: "Nike Sportswear Club Fleece Crewneck - Obsidian (L)", quantity: 1, price: 54.99, sku: "NK-CLB-CRW-OBS-L" }
    ],
    timeline: [
      { time: "22 Oct, 18:45", event: "Order placed by Amara Patel (£54.99)", status: "info" },
      { time: "23 Oct, 13:20", event: "Delivered on schedule", status: "success" }
    ]
  },
  {
    id: "#1035",
    customerName: "Oliver Taylor",
    customerEmail: "oliver.taylor@example.co.uk",
    customerLocation: "15 Bold Street, Liverpool, L1 4DJ",
    total: 89.99,
    currency: "GBP",
    paymentStatus: "Paid",
    fulfillmentStatus: "Fulfilled",
    orderDate: "22 Oct, 12:30",
    items: [
      { name: "Nike Air Zoom Structure 25 - Black / White (UK 9)", quantity: 1, price: 89.99, sku: "NK-STR25-BLK-9" }
    ],
    timeline: [
      { time: "22 Oct, 12:30", event: "Order placed by Oliver Taylor (£89.99)", status: "info" },
      { time: "23 Oct, 11:00", event: "Delivered on schedule", status: "success" }
    ]
  }
];

export type KpiKey = "sales" | "orders" | "delivery" | "sessions";

export type KpiConfig = {
  key: KpiKey;
  label: string;
  upIsGood: boolean;
  prev: number[];
  fmt: (n: number) => string;
  formatValue: (n: number) => string;
  baseVal: number;
  anomVal: number;
  baseDelta: number;
  anomDelta: number;
  baseData: number[];
  anomData: number[];
};

const trim = (n: number) => {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};

// 25 Checkpoints (every 6h: 00:00, 06:00, 12:00, 18:00 across 18-24 Oct 2026)
const CHART_TIMESTAMPS = [
  "18 Oct 00:00", "18 Oct 06:00", "18 Oct 12:00", "18 Oct 18:00",
  "19 Oct 00:00", "19 Oct 06:00", "19 Oct 12:00", "19 Oct 18:00",
  "20 Oct 00:00", "20 Oct 06:00", "20 Oct 12:00", "20 Oct 18:00",
  "21 Oct 00:00", "21 Oct 06:00", "21 Oct 12:00", "21 Oct 18:00",
  "22 Oct 00:00", "22 Oct 06:00", "22 Oct 12:00", "22 Oct 18:00",
  "23 Oct 00:00", "23 Oct 06:00", "23 Oct 12:00", "23 Oct 18:00",
  "24 Oct 18:00"
];

const CHART_PREV_TIMESTAMPS = [
  "11 Oct 00:00", "11 Oct 06:00", "11 Oct 12:00", "11 Oct 18:00",
  "12 Oct 00:00", "12 Oct 06:00", "12 Oct 12:00", "12 Oct 18:00",
  "13 Oct 00:00", "13 Oct 06:00", "13 Oct 12:00", "13 Oct 18:00",
  "14 Oct 00:00", "14 Oct 06:00", "14 Oct 12:00", "14 Oct 18:00",
  "15 Oct 00:00", "15 Oct 06:00", "15 Oct 12:00", "15 Oct 18:00",
  "16 Oct 00:00", "16 Oct 06:00", "16 Oct 12:00", "16 Oct 18:00",
  "17 Oct 18:00"
];

// Rich, dynamic, organic synthetic time-series (No sawtooth sine waves!)
const KPI_SERIES: Record<KpiKey, KpiConfig> = {
  sales: {
    key: "sales",
    label: "Total sales",
    upIsGood: true,
    prev: [0.7, 1.6, 3.3, 2.7, 0.6, 1.5, 3.0, 2.8, 0.5, 1.3, 2.5, 2.1, 0.5, 1.4, 2.6, 2.2, 0.6, 1.5, 2.7, 2.3, 0.6, 1.6, 2.8, 2.4, 0.7],
    fmt: (n) => `£${trim(n)}k`,
    formatValue: (n) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    baseVal: 52340.0,
    anomVal: 38420.0,
    baseDelta: 8,
    anomDelta: -24,
    baseData: [0.8, 1.8, 3.6, 2.9, 0.7, 1.7, 3.3, 3.0, 0.5, 1.4, 2.7, 2.3, 0.6, 1.5, 2.8, 2.3, 0.6, 1.6, 2.9, 2.4, 0.7, 1.7, 3.0, 2.5, 0.8],
    anomData: [0.8, 1.8, 3.6, 2.9, 0.7, 1.7, 3.3, 3.0, 0.5, 1.4, 2.7, 2.3, 0.6, 1.5, 2.8, 2.3, 0.6, 1.4, 1.8, 1.4, 0.4, 1.0, 1.5, 1.2, 0.4]
  },
  orders: {
    key: "orders",
    label: "Orders",
    upIsGood: true,
    prev: [2, 4, 6, 5, 2, 4, 5, 5, 1, 3, 5, 4, 2, 3, 5, 4, 2, 4, 5, 4, 2, 4, 5, 5, 2],
    fmt: (n) => trim(n),
    formatValue: (n) => Math.round(n).toString(),
    baseVal: 111,
    anomVal: 73,
    baseDelta: 7,
    anomDelta: -34,
    baseData: [2, 5, 6, 6, 2, 4, 6, 5, 2, 4, 5, 5, 2, 4, 6, 5, 2, 4, 6, 5, 2, 4, 6, 5, 2],
    anomData: [2, 5, 6, 6, 2, 4, 6, 5, 2, 4, 5, 5, 2, 4, 6, 5, 2, 4, 4, 3, 1, 2, 2, 2, 1]
  },
  delivery: {
    key: "delivery",
    label: "On-time delivery",
    upIsGood: true,
    prev: [96.8, 97.4, 98.1, 96.2, 95.4, 96.2, 97.5, 96.8, 94.2, 95.8, 97.9, 98.4, 97.2, 98.0, 98.7, 98.2, 97.5, 98.2, 98.6, 98.0, 97.3, 98.1, 98.5, 97.9, 98.1],
    fmt: (n) => `${trim(n)}%`,
    formatValue: (n) => `${n.toFixed(1)}%`,
    baseVal: 98.2,
    anomVal: 65.8,
    baseDelta: 1,
    anomDelta: -33,
    baseData: [97.2, 97.8, 98.4, 96.5, 95.8, 96.4, 97.9, 97.1, 94.6, 95.5, 98.1, 98.6, 97.4, 98.2, 98.9, 98.5, 97.8, 98.4, 98.8, 98.2, 97.5, 98.3, 98.7, 98.1, 98.2],
    anomData: [97.2, 97.8, 98.4, 96.5, 95.8, 96.4, 97.9, 97.1, 94.6, 95.5, 98.1, 98.6, 97.4, 98.2, 98.9, 98.5, 97.8, 95.1, 91.6, 87.4, 82.8, 78.2, 73.5, 69.8, 65.8]
  },
  sessions: {
    key: "sessions",
    label: "Sessions",
    upIsGood: true,
    prev: [2.1, 4.8, 6.7, 7.9, 2.0, 4.6, 6.5, 7.8, 1.8, 4.2, 5.9, 7.1, 1.9, 4.3, 6.1, 7.3, 2.0, 4.5, 6.3, 7.5, 2.1, 4.6, 6.5, 7.7, 2.3],
    fmt: (n) => `${trim(n)}k`,
    formatValue: (n) => Math.round(n).toLocaleString("en-GB"),
    baseVal: 142800,
    anomVal: 118200,
    baseDelta: 12,
    anomDelta: -17,
    baseData: [2.3, 5.2, 7.3, 8.6, 2.2, 5.0, 7.0, 8.4, 2.0, 4.6, 6.4, 7.7, 2.1, 4.7, 6.6, 7.9, 2.2, 4.9, 6.8, 8.1, 2.3, 5.0, 7.1, 8.3, 2.5],
    anomData: [2.3, 5.2, 7.3, 8.6, 2.2, 5.0, 7.0, 8.4, 2.0, 4.6, 6.4, 7.7, 2.1, 4.7, 6.6, 7.9, 2.2, 4.4, 5.6, 6.2, 1.6, 3.6, 4.9, 5.7, 1.7]
  }
};

const KPI_ORDER: KpiKey[] = ["sales", "orders", "delivery", "sessions"];

const CHART_DAYS = ["18 Oct", "19 Oct", "20 Oct", "21 Oct", "22 Oct", "23 Oct", "24 Oct"];

function niceMax(m: number, isPercent = false) {
  if (isPercent) return 100;
  const target = m * 1.08 || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(target)));
  for (const f of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (f * mag >= target) return f * mag;
  }
  return 10 * mag;
}

function smoothPath(pts: [number, number][]) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

// Mini Sparkline component for the 4 top cards (1:1 with Shopify screenshot)
function MiniSparkline({ data, critical = false }: { data: number[]; critical?: boolean }) {
  const n = data.length;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => [
    (i * 100) / (n - 1),
    Math.max(8, Math.min(92, 92 - ((v - min) / range) * 76))
  ] as [number, number]);
  const strokeColor = critical ? "#c70a24" : "#5c9ee8";
  return (
    <div className="w-24 h-6 flex items-center justify-end">
      <svg className="w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path
          d={smoothPath(pts)}
          fill="none"
          stroke={strokeColor}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function PolarisLineChart({
  data,
  prev,
  fmt,
  critical = false,
  kpiKey = "delivery",
  animProgress = 0
}: {
  data: number[];
  prev: number[];
  fmt: (n: number) => string;
  critical?: boolean;
  kpiKey?: KpiKey;
  animProgress?: number;
}) {
  const lineColor = critical ? "#c70a24" : "#3c8de0";
  const [hover, setHover] = useState<number | null>(null);
  const n = data.length;

  let min = 0;
  let max = 100;
  let labels: number[] = [];

  if (kpiKey === "delivery") {
    const currentMin = 90 - 30 * animProgress;
    min = currentMin;
    max = 100;
    labels = animProgress > 0.35 ? [100, 90, 80, 70, 60] : [100, 97.5, 95, 92.5, 90];
  } else {
    max = niceMax(Math.max(...data, ...prev));
    min = 0;
    labels = [max, Math.round(max * 0.75 * 10) / 10, Math.round(max * 0.5 * 10) / 10, Math.round(max * 0.25 * 10) / 10, 0];
  }

  const toPts = (arr: number[]) =>
    arr.map((v, i) => [
      (i * 100) / (n - 1),
      Math.max(0, Math.min(100, 100 - ((v - min) / (max - min)) * 100))
    ] as [number, number]);

  const cur = toPts(data);
  const old = toPts(prev);

  return (
    <div>
      <div className="relative h-[220px]">
        {/* Y axis labels */}
        <div className="absolute bottom-2 left-0 top-2 w-10">
          {labels.map((t, i) => (
            <span
              key={i}
              className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums text-[#616161]"
              style={{ top: `${(i / (labels.length - 1)) * 100}%` }}
            >
              {fmt(t)}
            </span>
          ))}
        </div>

        {/* Plot */}
        <div
          className="absolute bottom-2 left-12 right-2 top-2"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
            setHover(Math.max(0, Math.min(n - 1, i)));
          }}
          onMouseLeave={() => setHover(null)}
        >
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
            {[0, 25, 50, 75, 100].map((y) => (
              <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="#ebebeb" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            <defs>
              <linearGradient id="pfLineFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={critical ? 0.32 : 0.22} />
                <stop offset="55%" stopColor={lineColor} stopOpacity={critical ? 0.14 : 0.08} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <path
              d={smoothPath(old)}
              fill="none"
              stroke="#7eb8f7"
              strokeWidth="2"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
            <path d={`${smoothPath(cur)} L100,100 L0,100 Z`} fill="url(#pfLineFill)" stroke="none" />
            <path
              d={smoothPath(cur)}
              fill="none"
              stroke={lineColor}
              strokeWidth={critical ? 2.5 : 2.2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {hover !== null && (
              <>
                <line
                  x1={cur[hover][0]}
                  x2={cur[hover][0]}
                  y1="0"
                  y2="100"
                  stroke="#70767c"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={old[hover][0]}
                  cy={old[hover][1]}
                  r="3.5"
                  fill="#ffffff"
                  stroke="#7eb8f7"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={cur[hover][0]}
                  cy={cur[hover][1]}
                  r="4.5"
                  fill="#ffffff"
                  stroke={lineColor}
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={cur[hover][0]}
                  cy={cur[hover][1]}
                  r="8.5"
                  fill="none"
                  stroke={lineColor}
                  strokeOpacity="0.25"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}
          </svg>

          {hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 w-52 rounded-lg bg-white p-2.5 text-[12px] shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_4px_16px_rgba(0,0,0,0.14)]"
              style={
                cur[hover][0] > 65
                  ? { right: `${100 - cur[hover][0] + 2}%` }
                  : { left: `${cur[hover][0] + 2}%` }
              }
            >
              <div className="mb-1.5 border-b border-[#f1f1f1] pb-1 font-semibold text-[#202223]">
                {CHART_TIMESTAMPS[hover] || CHART_DAYS[Math.min(hover, CHART_DAYS.length - 1)]}
              </div>
              <div className="flex items-center justify-between gap-2 text-[#303030]">
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: lineColor }} />
                  Current period
                </span>
                <span className="font-bold tabular-nums" style={{ color: lineColor }}>{fmt(data[hover])}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[#616161]">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full border border-[#7eb8f7] bg-white" />
                  Previous period
                </span>
                <span className="tabular-nums font-medium">{fmt(prev[hover])}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ml-12 mr-2 mt-2 flex justify-between text-[11px] text-[#616161]">
        {CHART_DAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-center gap-5 text-[12px] text-[#616161]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: lineColor }} />
          18–24 Oct 2026 (This period)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed border-[#7eb8f7]" />
          11–17 Oct 2026 (Previous period)
        </span>
      </div>
    </div>
  );
}

export default function ShopifyDashboardPage() {
  const [selectedRange, setSelectedRange] = useState("Last 30 days");
  const [activeOrderTab, setActiveOrderTab] = useState<"all" | "delayed" | "unfulfilled">("all");
  const [selectedOrder, setSelectedOrder] = useState<ShopifyOrder | null>(null);
  const [showSidekickDrawer, setShowSidekickDrawer] = useState(false);
  const [showNikeProfileModal, setShowNikeProfileModal] = useState(false);
  const [activeSidebarNav, setActiveSidebarNav] = useState<string>("attribution");

  // Selected KPI metric tab for the main Home chart
  const [selectedKpi, setSelectedKpi] = useState<KpiKey>("sales");

  // Clean, realistic state transition with real-time numeric countdown
  const [showLatestReport, setShowLatestReport] = useState(false);
  const [animProgress, setAnimProgress] = useState(0); // 0 = baseline, 1 = anomaly
  const [isAnimatingDown, setIsAnimatingDown] = useState(false);

  // Animated values for 1:1 Attribution cards
  const animatedSales = useMemo(() => {
    const start = 52340.0;
    const target = 38420.0;
    return start - (start - target) * animProgress;
  }, [animProgress]);

  const animatedOrders = useMemo(() => {
    const start = 111;
    const target = 73;
    return Math.round(start - (start - target) * animProgress);
  }, [animProgress]);

  const animatedAov = useMemo(() => {
    const start = 471.53;
    const target = 384.20;
    return start - (start - target) * animProgress;
  }, [animProgress]);

  const animatedSessions = useMemo(() => {
    const start = 142800;
    const target = 118200;
    return Math.round(start - (start - target) * animProgress);
  }, [animProgress]);

  // Live simulation tick trigger
  const [simBusy, setSimBusy] = useState(false);

  // Polaris Toast
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Real-time animated countdown of all numbers
  const triggerSweepDownToLatestReport = () => {
    if (isAnimatingDown) return;
    setIsAnimatingDown(true);
    setShowLatestReport(true);
    setActiveOrderTab("delayed");

    const startTime = performance.now();
    const duration = 2800; // 2.8s smooth, slower countdown animation

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const p = Math.min(elapsed / duration, 1);
      const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      setAnimProgress(ease);

      if (p < 1) {
        requestAnimationFrame(animate);
      } else {
        setIsAnimatingDown(false);
        setToast("Latest report loaded — 38 orders delayed");
      }
    };

    requestAnimationFrame(animate);
  };

  const triggerResetToBaseline = () => {
    if (isAnimatingDown) return;
    setIsAnimatingDown(true);
    const startTime = performance.now();
    const duration = 1400;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const p = Math.min(elapsed / duration, 1);
      const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      setAnimProgress(1 - ease);

      if (p < 1) {
        requestAnimationFrame(animate);
      } else {
        setShowLatestReport(false);
        setIsAnimatingDown(false);
        setActiveOrderTab("all");
        setToast("Reset to healthy baseline report");
      }
    };

    requestAnimationFrame(animate);
  };

  const runSimulationTick = async () => {
    setSimBusy(true);
    triggerResetToBaseline();
    setToast("Synthetic presentation reset — no operational data changed");
    setSimBusy(false);
  };

  const filteredOrders = useMemo(() => {
    return SYNTHETIC_ORDERS.filter((o) => {
      if (activeOrderTab === "delayed") return o.fulfillmentStatus === "Delayed";
      if (activeOrderTab === "unfulfilled") return o.fulfillmentStatus === "Delayed" || o.fulfillmentStatus === "Unfulfilled";
      return true;
    });
  }, [activeOrderTab]);

  return (
    <div className="partner-shopify flex h-screen w-screen overflow-hidden bg-[#0d0d0e] font-sans antialiased text-[#202223]">
      {/* 1. LEFT DARK SIDEBAR (1:1 with Shopify Admin Attribution Screenshot) */}
      <aside className="w-[240px] bg-[#0f0f11] text-[#8e8f91] border-r border-[#1f2022] flex flex-col justify-between flex-shrink-0 select-none relative overflow-y-auto z-20">
        {/* Subtle atmospheric ambient green glow at bottom-left */}
        <div className="pointer-events-none absolute -bottom-10 -left-10 w-56 h-56 rounded-full bg-gradient-to-tr from-[#008060]/30 via-[#004c3f]/15 to-transparent blur-3xl -z-0" />

        <div className="relative z-10 flex flex-col">
          {/* Top Header: Shopify Bag Logo + Collapse Button */}
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <ShopifyLogo className="w-6 h-6" />
            </div>
            <button
              className="p-1 rounded text-[#78797b] hover:text-white hover:bg-[#1f2022] transition-colors"
              title="Collapse sidebar"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Search bar with ⌘K pill */}
          <div className="px-3 pb-3">
            <div className="flex items-center justify-between rounded-lg bg-[#1b1c1e] px-2.5 py-1.5 text-[13px] text-[#8e8f91] border border-[#262729] hover:border-[#38393c] transition-colors cursor-pointer">
              <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-[#78797b]" />
                <span className="text-[12px]">Search</span>
              </div>
              <span className="text-[10px] font-medium text-[#646567] bg-[#242528] px-1.5 py-0.5 rounded border border-[#2e2f32]">
                ⌘K
              </span>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="px-2 space-y-0.5 text-[13px]">
            <button
              onClick={() => setActiveSidebarNav("home")}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                activeSidebarNav === "home" ? "bg-[#2a2b2d] text-white font-medium" : "text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d]"
              }`}
            >
              <Home className="w-4 h-4 text-[#78797b]" />
              <span>Home</span>
            </button>

            <button
              onClick={() => setActiveSidebarNav("orders")}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                activeSidebarNav === "orders" ? "bg-[#2a2b2d] text-white font-medium" : "text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d]"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Package className="w-4 h-4 text-[#78797b]" />
                <span>Orders</span>
              </div>
              {showLatestReport && (
                <span className="bg-[#fedad9] text-[#8e0b21] text-[10px] font-semibold px-1.5 py-0.2 rounded-full">
                  38 delayed
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveSidebarNav("products")}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                activeSidebarNav === "products" ? "bg-[#2a2b2d] text-white font-medium" : "text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d]"
              }`}
            >
              <Tag className="w-4 h-4 text-[#78797b]" />
              <span>Products</span>
            </button>

            <button
              onClick={() => setActiveSidebarNav("customers")}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                activeSidebarNav === "customers" ? "bg-[#2a2b2d] text-white font-medium" : "text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d]"
              }`}
            >
              <Users className="w-4 h-4 text-[#78797b]" />
              <span>Customers</span>
            </button>

            {/* Growth Section with Attribution Selected */}
            <div className="pt-1">
              <div className="flex items-center justify-between px-2.5 py-1 text-[#8e8f91] text-[13px]">
                <div className="flex items-center gap-2.5">
                  <Activity className="w-4 h-4 text-[#78797b]" />
                  <span>Growth</span>
                </div>
              </div>
              <div className="pl-6 space-y-0.5">
                <button
                  onClick={() => setActiveSidebarNav("attribution")}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                    activeSidebarNav === "attribution" ? "bg-[#2a2b2d] text-white font-semibold shadow-sm" : "text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d]"
                  }`}
                >
                  <span>Attribution</span>
                </button>
                <button
                  onClick={() => setActiveSidebarNav("autopilot")}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d] transition-colors"
                >
                  <span>Autopilot</span>
                </button>
                <button
                  onClick={() => setActiveSidebarNav("campaigns")}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d] transition-colors"
                >
                  <span>Campaigns</span>
                </button>
              </div>
            </div>

            <button
              onClick={() => setActiveSidebarNav("discounts")}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d] transition-colors"
            >
              <Percent className="w-4 h-4 text-[#78797b]" />
              <span>Discounts</span>
            </button>

            <button
              onClick={() => setActiveSidebarNav("content")}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d] transition-colors"
            >
              <FileText className="w-4 h-4 text-[#78797b]" />
              <span>Content</span>
            </button>

            <button
              onClick={() => setActiveSidebarNav("markets")}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d] transition-colors"
            >
              <Globe className="w-4 h-4 text-[#78797b]" />
              <span>Markets</span>
            </button>

            <button
              onClick={() => setActiveSidebarNav("finance")}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d] transition-colors"
            >
              <Landmark className="w-4 h-4 text-[#78797b]" />
              <span>Finance</span>
            </button>

            <button
              onClick={() => setActiveSidebarNav("analytics")}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d] transition-colors"
            >
              <BarChart3 className="w-4 h-4 text-[#78797b]" />
              <span>Analytics</span>
            </button>
          </nav>

          {/* Section: Sales channels */}
          <div className="px-2 pt-3">
            <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-semibold text-[#646567] uppercase tracking-wider">
              <span>Sales channels</span>
              <ChevronRight className="w-3 h-3 text-[#646567]" />
            </div>
            <div className="space-y-0.5">
              <a
                href="/store?ops=1"
                target="_blank"
                rel="noreferrer"
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d] text-[13px] transition-colors group"
              >
                <div className="flex items-center gap-2.5">
                  <Store className="w-4 h-4 text-[#78797b]" />
                  <span>Online Store</span>
                </div>
                <Eye className="w-3.5 h-3.5 text-[#555] opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
              <a
                href="/dashboard"
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d] text-[13px] transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-4 h-4 text-[#a855f7]" />
                  <span className="text-[#e2e8f0]">Agentic</span>
                </div>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </a>
            </div>
          </div>

          {/* Section: Apps */}
          <div className="px-2 pt-3">
            <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-semibold text-[#646567] uppercase tracking-wider">
              <span>Apps</span>
              <ChevronRight className="w-3 h-3 text-[#646567]" />
            </div>
            <div className="space-y-0.5">
              <button className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d] text-[13px] transition-colors">
                <Plus className="w-4 h-4 text-[#78797b]" />
                <span>Add</span>
              </button>
              <a
                href="/dashboard"
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d] text-[13px] transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-4 w-4 items-center justify-center rounded bg-[#1a1a1a] text-[9px] font-bold text-white border border-[#333]">
                    N
                  </div>
                  <span>Normal Operations</span>
                </div>
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
              </a>
            </div>
          </div>
        </div>

        {/* Bottom Sidebar: Settings + Nike Store Avatar */}
        <div className="relative z-10 p-2 border-t border-[#1f2022] space-y-1">
          <button
            onClick={() => setShowNikeProfileModal(true)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-[#8e8f91] hover:text-white hover:bg-[#1a1b1d] text-[13px] transition-colors"
          >
            <Settings className="w-4 h-4 text-[#78797b]" />
            <span>Settings</span>
          </button>

          {/* NIKE STORE SWITCHER / PROFILE (Sidebar Bottom) */}
          <div
            onClick={() => setShowNikeProfileModal(true)}
            className="flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-[#1a1b1d] transition-colors cursor-pointer group"
            title="Nike UK Direct Store Profile (Shopify Plus)"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black text-white p-1 border border-zinc-700 shadow-sm flex-shrink-0 group-hover:border-zinc-500 transition-colors">
                <NikeSwoosh className="w-4 h-4 fill-white" />
              </div>
              <div className="flex flex-col min-w-0 leading-tight">
                <div className="text-[13px] font-semibold text-white truncate flex items-center gap-1">
                  <span>Nike UK Direct</span>
                </div>
                <span className="text-[10px] text-zinc-400 font-medium flex items-center gap-1">
                  <span>Shopify Plus</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                </span>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setToast("2 notifications: Leeds conveyor disruption active");
              }}
              className="text-[#78797b] hover:text-white p-1"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* 2. MAIN WORKSPACE CANVAS (1:1 with Shopify Admin Attribution View) */}
      <main className="flex-1 overflow-y-auto bg-white rounded-r-xl border border-zinc-200/80 flex flex-col relative shadow-sm">
        <div className="max-w-[1400px] w-full mx-auto p-6 space-y-4">
          {/* Top Title Bar: Attribution Squiggle + Performance Dropdown */}
          <div className="flex items-center justify-between pb-1">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#202223]" />
              <h1 className="text-[17px] font-bold text-[#202223]">Attribution</h1>
              <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#d2d5d8] bg-white text-[12px] font-medium text-[#202223] shadow-xs hover:bg-[#f1f2f4] transition-colors cursor-pointer">
                <span>Performance</span>
                <ArrowUpDown className="w-3 h-3 text-[#6d7175]" />
              </button>
            </div>

            {/* Clean, authentic Polaris action button */}
            <div className="flex items-center gap-2">
              {showLatestReport ? (
                <button
                  onClick={triggerResetToBaseline}
                  disabled={isAnimatingDown}
                  className="flex items-center gap-1.5 rounded-lg border border-[#c9cccf] bg-white px-3 py-1.5 text-[12px] font-medium text-[#202223] shadow-xs hover:bg-[#f6f6f7] transition-all cursor-pointer"
                >
                  <RotateCcw className={`h-3 w-3 text-[#5c5f62] ${isAnimatingDown ? "animate-spin" : ""}`} />
                  <span>Previous report</span>
                </button>
              ) : (
                <button
                  id="btn-latest-report"
                  onClick={triggerSweepDownToLatestReport}
                  disabled={isAnimatingDown}
                  className="flex items-center gap-1.5 rounded-lg bg-[#1a1a1a] px-3 py-1.5 text-[12px] font-semibold text-white shadow-xs hover:bg-[#303030] transition-all cursor-pointer"
                >
                  <ArrowDown className={`h-3 w-3 ${isAnimatingDown ? "animate-bounce" : ""}`} />
                  <span>View latest report</span>
                </button>
              )}
            </div>
          </div>

          {/* Filter Bar: Date Range Picker + Attribution Models (1:1 with Screenshot) */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f1f1f1] hover:bg-[#e8e8e8] text-[12px] font-medium text-[#202223] transition-colors cursor-pointer">
                <Calendar className="w-3.5 h-3.5 text-[#6d7175]" />
                <span>Last 30 days</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#6d7175]" />
              </button>

              <button
                onClick={showLatestReport ? triggerResetToBaseline : triggerSweepDownToLatestReport}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f1f1f1] hover:bg-[#e8e8e8] text-[12px] font-medium text-[#202223] transition-colors cursor-pointer"
                title="Click to toggle carrier report"
              >
                <RotateCcw className={`w-3.5 h-3.5 text-[#6d7175] ${isAnimatingDown ? "animate-spin" : ""}`} />
                <span>Aug 24–Sep 23, 2026</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#6d7175]" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f1f1f1] hover:bg-[#e8e8e8] text-[12px] font-medium text-[#202223] transition-colors cursor-pointer">
                <BarChart3 className="w-3.5 h-3.5 text-[#6d7175]" />
                <span>Last non-direct click</span>
                <ArrowUpDown className="w-3.5 h-3.5 text-[#6d7175]" />
              </button>

              <button className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f1f1f1] hover:bg-[#e8e8e8] text-[12px] font-medium text-[#202223] transition-colors cursor-pointer">
                <Sparkles className="w-3.5 h-3.5 text-[#6d7175]" />
                <span>Marketing traffic</span>
                <ArrowUpDown className="w-3.5 h-3.5 text-[#6d7175]" />
              </button>
            </div>
          </div>

          {/* 3. ROW OF 4 TOP KPI METRIC CARDS (1:1 with Screenshot) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Card 1: Total sales */}
            <div className="bg-white rounded-2xl border border-[#e3e3e3] p-4 flex flex-col justify-between h-[86px] shadow-xs hover:border-[#c9cccf] transition-all">
              <div className="text-[12px] font-medium text-[#6d7175]">
                <span className="border-b border-dotted border-[#6d7175]/60 pb-0.5">Total sales</span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <div className={`text-[20px] font-bold tracking-tight transition-colors duration-200 ${animProgress > 0.1 ? "text-[#c70a24]" : "text-[#202223]"}`}>
                  £{animatedSales.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                {animProgress > 0.05 ? (
                  <svg className="w-14 h-3.5" viewBox="0 0 56 14">
                    <path d={`M 0 2 Q 28 2, 56 ${2 + 10 * animProgress}`} fill="none" stroke="#c70a24" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <div className="w-14 h-[2px] bg-[#78b7ee] rounded-full self-end" />
                )}
              </div>
            </div>

            {/* Card 2: Orders */}
            <div className="bg-white rounded-2xl border border-[#e3e3e3] p-4 flex flex-col justify-between h-[86px] shadow-xs hover:border-[#c9cccf] transition-all">
              <div className="text-[12px] font-medium text-[#6d7175]">
                <span className="border-b border-dotted border-[#6d7175]/60 pb-0.5">Orders</span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <div className={`text-[20px] font-bold tracking-tight transition-colors duration-200 ${animProgress > 0.1 ? "text-[#c70a24]" : "text-[#202223]"}`}>
                  {animatedOrders}
                </div>
                {animProgress > 0.05 ? (
                  <svg className="w-14 h-3.5" viewBox="0 0 56 14">
                    <path d={`M 0 2 Q 28 2, 56 ${2 + 10 * animProgress}`} fill="none" stroke="#c70a24" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <div className="w-14 h-[2px] bg-[#78b7ee] rounded-full self-end" />
                )}
              </div>
            </div>

            {/* Card 3: Average order value */}
            <div className="bg-white rounded-2xl border border-[#e3e3e3] p-4 flex flex-col justify-between h-[86px] shadow-xs hover:border-[#c9cccf] transition-all">
              <div className="text-[12px] font-medium text-[#6d7175]">
                <span className="border-b border-dotted border-[#6d7175]/60 pb-0.5">Average order value</span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <div className={`text-[20px] font-bold tracking-tight transition-colors duration-200 ${animProgress > 0.1 ? "text-[#c70a24]" : "text-[#202223]"}`}>
                  £{animatedAov.toFixed(2)}
                </div>
                {animProgress > 0.05 ? (
                  <svg className="w-14 h-3.5" viewBox="0 0 56 14">
                    <path d={`M 0 2 Q 28 2, 56 ${2 + 10 * animProgress}`} fill="none" stroke="#c70a24" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <div className="w-14 h-[2px] bg-[#78b7ee] rounded-full self-end" />
                )}
              </div>
            </div>

            {/* Card 4: Sessions */}
            <div className="bg-white rounded-2xl border border-[#e3e3e3] p-4 flex flex-col justify-between h-[86px] shadow-xs hover:border-[#c9cccf] transition-all">
              <div className="text-[12px] font-medium text-[#6d7175]">
                <span className="border-b border-dotted border-[#6d7175]/60 pb-0.5">Sessions</span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <div className={`text-[20px] font-bold tracking-tight transition-colors duration-200 ${animProgress > 0.1 ? "text-[#c70a24]" : "text-[#202223]"}`}>
                  {animatedSessions.toLocaleString("en-GB")}
                </div>
                {animProgress > 0.05 ? (
                  <svg className="w-14 h-3.5" viewBox="0 0 56 14">
                    <path d={`M 0 2 Q 28 2, 56 ${2 + 10 * animProgress}`} fill="none" stroke="#c70a24" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <div className="w-14 h-[2px] bg-[#78b7ee] rounded-full self-end" />
                )}
              </div>
            </div>
          </div>

          {/* 5. CARD 1: TOP PERFORMING MARKETING CHANNELS (1:1 with Screenshot Header) */}
          <div className="rounded-xl border border-[#e1e3e5] bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f1f2f4]">
              <h2 className="text-[14px] font-semibold text-[#202223] border-b border-dotted border-[#8c9196] cursor-pointer">
                Top performing marketing channels
              </h2>
              <button
                onClick={() => setActiveSidebarNav("orders")}
                className="text-[13px] font-medium text-[#202223] hover:underline cursor-pointer"
              >
                View all
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead className="bg-[#f7f7f8] text-[12px] text-[#6d7175] border-b border-[#ebebeb]">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Channel</th>
                    <th className="px-4 py-2.5 text-right font-medium">Sessions</th>
                    <th className="px-4 py-2.5 text-right font-medium">Orders</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total sales</th>
                    <th className="px-4 py-2.5 font-medium">Status & Autonomous Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ebebeb] text-[#202223]">
                  {/* Row 1: Meta Ads */}
                  <tr className="hover:bg-[#f9fafb] transition-colors">
                    <td className="px-5 py-3 font-medium flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-600" />
                      <span>Meta Ads (Facebook & Instagram)</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {Math.round(68400 - (68400 - 43800) * animProgress).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      {Math.round(52 - (52 - 31) * animProgress)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">
                      £{(24680 - (24680 - 15820) * animProgress).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3">
                      {showLatestReport ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e3f1df] px-2 py-0.5 text-[11px] font-medium text-[#008060] border border-[#b4e3ad]">
                          <Check className="h-3 w-3" />
                          <span>Budget throttled to £30/d by Normal</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-[#f1f2f4] px-2 py-0.5 text-[11px] font-medium text-[#5c5f62]">
                          Active · £50/day spend
                        </span>
                      )}
                    </td>
                  </tr>

                  {/* Row 2: Google Ads */}
                  <tr className="hover:bg-[#f9fafb] transition-colors">
                    <td className="px-5 py-3 font-medium flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>Google Performance Max & Search</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">41,200</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">32</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">£14,820.00</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-[#f1f2f4] px-2 py-0.5 text-[11px] font-medium text-[#5c5f62]">
                        Active · Normal monitoring
                      </span>
                    </td>
                  </tr>

                  {/* Row 3: Direct Storefront */}
                  <tr className="hover:bg-[#f9fafb] transition-colors">
                    <td className="px-5 py-3 font-medium flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>Direct Storefront (nike.com/uk)</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">21,800</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">18</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">£8,450.00</td>
                    <td className="px-4 py-3">
                      {showLatestReport ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fedad9] px-2 py-0.5 text-[11px] font-medium text-[#8e0b21]">
                          <AlertTriangle className="h-3 w-3" />
                          <span>Delivery notice active on checkout</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-[#f1f2f4] px-2 py-0.5 text-[11px] font-medium text-[#5c5f62]">
                          Healthy · Normal traffic
                        </span>
                      )}
                    </td>
                  </tr>

                  {/* Row 4: Email & CRM */}
                  <tr className="hover:bg-[#f9fafb] transition-colors">
                    <td className="px-5 py-3 font-medium flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-purple-500" />
                      <span>Klaviyo / Shopify Email</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">11,400</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">9</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">£4,390.00</td>
                    <td className="px-4 py-3">
                      {showLatestReport ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e0f0ff] px-2 py-0.5 text-[11px] font-medium text-[#005bd3]">
                          <Truck className="h-3 w-3" />
                          <span>38 delay compensation emails queued</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-[#f1f2f4] px-2 py-0.5 text-[11px] font-medium text-[#5c5f62]">
                          Standard campaign flow
                        </span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 6. CARD 2: TOP PERFORMING MARKETING CAMPAIGNS (1:1 with Screenshot Header) */}
          <div className="rounded-xl border border-[#e1e3e5] bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f1f2f4]">
              <h2 className="text-[14px] font-semibold text-[#202223] border-b border-dotted border-[#8c9196] cursor-pointer">
                Top performing marketing campaigns
              </h2>
              <button
                onClick={() => setActiveSidebarNav("campaigns")}
                className="text-[13px] font-medium text-[#202223] hover:underline cursor-pointer"
              >
                View all
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead className="bg-[#f7f7f8] text-[12px] text-[#6d7175] border-b border-[#ebebeb]">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Campaign name</th>
                    <th className="px-4 py-2.5 font-medium">Channel</th>
                    <th className="px-4 py-2.5 text-right font-medium">Orders</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total sales</th>
                    <th className="px-4 py-2.5 text-right font-medium">ROAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ebebeb] text-[#202223]">
                  <tr className="hover:bg-[#f9fafb] transition-colors">
                    <td className="px-5 py-3 font-semibold text-[#202223]">
                      Nike Air Max 90 Autumn Campaign - Meta UK
                    </td>
                    <td className="px-4 py-3 text-[#6d7175]">Meta Ads</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">34</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">£16,240.00</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600 font-semibold">4.8x</td>
                  </tr>
                  <tr className="hover:bg-[#f9fafb] transition-colors">
                    <td className="px-5 py-3 font-semibold text-[#202223]">
                      Nike Tech Fleece UK Launch - PMax
                    </td>
                    <td className="px-4 py-3 text-[#6d7175]">Google Performance Max</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">18</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">£8,440.00</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600 font-semibold">4.2x</td>
                  </tr>
                  <tr className="hover:bg-[#f9fafb] transition-colors">
                    <td className="px-5 py-3 font-semibold text-[#202223]">
                      Nike Pegasus 41 Road Running Push
                    </td>
                    <td className="px-4 py-3 text-[#6d7175]">Meta Ads</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">16</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">£7,910.00</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600 font-semibold">3.9x</td>
                  </tr>
                  <tr className="hover:bg-[#f9fafb] transition-colors">
                    <td className="px-5 py-3 font-semibold text-[#202223]">
                      Nike Football Winter Boots Retargeting
                    </td>
                    <td className="px-4 py-3 text-[#6d7175]">Google Search</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">11</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">£5,830.00</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600 font-semibold">5.1x</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* ORDERS DRAWER (When clicking Orders nav or View all) */}
      {activeSidebarNav === "orders" && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end animate-in fade-in">
          <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col p-6 animate-in slide-in-from-right duration-200 overflow-y-auto">
            <div className="flex justify-between items-center pb-4 border-b border-[#ebebeb]">
              <div>
                <h2 className="text-[16px] font-bold text-[#202223]">Recent Orders</h2>
                <p className="text-[12px] text-[#6d7175]">Nike UK Direct (Shopify Plus)</p>
              </div>
              <button
                onClick={() => setActiveSidebarNav("attribution")}
                className="text-zinc-500 hover:text-zinc-800 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-2 py-3 border-b border-[#ebebeb]">
              {(["all", "delayed", "unfulfilled"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveOrderTab(tab)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                    activeOrderTab === tab ? "bg-[#202223] text-white" : "bg-[#f1f2f4] text-[#4a4a4a] hover:bg-[#e4e5e7]"
                  }`}
                >
                  {tab === "delayed" ? "Delayed (38)" : tab}
                </button>
              ))}
            </div>

            <div className="divide-y divide-[#ebebeb] mt-3">
              {filteredOrders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  className="py-3.5 px-2 hover:bg-[#f9fafb] rounded-lg transition-colors cursor-pointer flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#202223]">{order.id}</span>
                      <span className="text-sm font-medium text-[#4a4a4a]">{order.customerName}</span>
                    </div>
                    <div className="text-xs text-[#6d7175] mt-0.5">{order.orderDate} · {order.items[0]?.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-[#202223]">£{order.total.toFixed(2)}</div>
                    <span
                      className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        order.fulfillmentStatus === "Delayed"
                          ? "bg-[#fedad9] text-[#8e0b21]"
                          : "bg-[#e3f1df] text-[#008060]"
                      }`}
                    >
                      {order.fulfillmentStatus}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ORDER DETAILS INSPECTION DRAWER */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end animate-in fade-in">
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col p-6 animate-in slide-in-from-right duration-200 overflow-y-auto">
            <div className="flex justify-between items-center pb-4 border-b border-[#ebebeb]">
              <div>
                <h3 className="text-base font-bold text-[#202223]">Order {selectedOrder.id}</h3>
                <p className="text-xs text-[#6d7175]">{selectedOrder.orderDate}</p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-zinc-500 hover:text-zinc-800 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 border-b border-[#ebebeb] space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#6d7175]">Customer Information</div>
              <div className="font-bold text-[#202223] text-sm">{selectedOrder.customerName}</div>
              <div className="text-xs text-[#4a4a4a]">{selectedOrder.customerEmail}</div>
              <div className="text-xs text-[#4a4a4a]">{selectedOrder.customerLocation}</div>
            </div>

            <div className="py-4 border-b border-[#ebebeb] space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#6d7175]">Fulfillment & Tracking</div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#4a4a4a]">{selectedOrder.carrierName}</span>
                <span className="text-xs font-mono font-bold text-[#005bd3]">{selectedOrder.carrierTracking}</span>
              </div>
              {selectedOrder.slaBreach && (
                <div className="bg-[#fff6f5] border border-[#fdb5b0] rounded-lg p-2.5 text-xs text-[#8e0b21] flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#c70a24]" />
                  <div>
                    <span className="font-bold">Carrier Delay Warning:</span> Delayed at Royal Mail Leeds Sort Center. Expected resolution in 24 hours.
                  </div>
                </div>
              )}
            </div>

            <div className="py-4 border-b border-[#ebebeb] space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#6d7175]">Line Items</div>
              {selectedOrder.items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-zinc-100 border border-zinc-200 flex items-center justify-center p-1.5 flex-shrink-0">
                      <NikeSwoosh className="w-4 h-4 fill-black" />
                    </div>
                    <div>
                      <div className="font-medium text-[#202223]">{item.name}</div>
                      <div className="text-[#6d7175]">SKU: {item.sku} · Qty: {item.quantity}</div>
                    </div>
                  </div>
                  <div className="font-bold text-[#202223]">£{item.price.toFixed(2)}</div>
                </div>
              ))}
            </div>

            <div className="py-4 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#6d7175]">Activity Timeline</div>
              <div className="space-y-3">
                {selectedOrder.timeline.map((t, idx) => (
                  <div key={idx} className="text-xs flex gap-2">
                    <span className="text-[#6d7175] flex-shrink-0 w-20">{t.time.split(",")[1] || t.time}</span>
                    <span className={`text-[11px] ${t.status === "error" ? "text-red-700 font-medium" : t.status === "warning" ? "text-amber-800" : "text-[#4a4a4a]"}`}>
                      {t.event}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NIKE PRODUCTS CATALOG DRAWER */}
      {activeSidebarNav === "products" && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end animate-in fade-in">
          <div className="w-full max-w-3xl bg-white h-full shadow-2xl flex flex-col p-6 animate-in slide-in-from-right duration-200 overflow-y-auto">
            <div className="flex justify-between items-center pb-4 border-b border-[#ebebeb]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-black text-white flex items-center justify-center p-2 shadow-sm">
                  <NikeSwoosh className="w-5 h-5 fill-white" />
                </div>
                <div>
                  <h2 className="text-[17px] font-bold text-[#202223]">Nike UK Direct — Product Catalog</h2>
                  <p className="text-[12px] text-[#6d7175]">8 Active SKUs · London Hub & Leeds Regional Distribution</p>
                </div>
              </div>
              <button
                onClick={() => setActiveSidebarNav("attribution")}
                className="text-zinc-500 hover:text-zinc-800 p-1.5 rounded-lg hover:bg-zinc-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#f6f6f7] text-[#6d7175] uppercase text-[10px] font-semibold tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Inventory</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3 text-right">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ebebeb]">
                  {NIKE_PRODUCTS_DATA.map((p) => (
                    <tr key={p.id} className="hover:bg-zinc-50 cursor-pointer">
                      <td className="px-4 py-3 font-semibold text-[#202223] flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded bg-zinc-100 border border-zinc-200 flex items-center justify-center p-1">
                          <NikeSwoosh className="w-3.5 h-3.5 fill-black" />
                        </div>
                        <div>
                          <div>{p.title}</div>
                          <span className="text-[10px] text-zinc-400 font-mono">{p.sku}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="bg-[#cbf4c9] text-[#0e6245] text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#6d7175]">{p.inventory}</td>
                      <td className="px-4 py-3 text-[#6d7175]">{p.category}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#202223]">
                        £{p.price.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* NIKE OPERATIONS MERCHANT PROFILE MODAL */}
      {showNikeProfileModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="relative bg-[#0f0f11] text-white p-6 pb-5 border-b border-zinc-800">
              <button
                onClick={() => setShowNikeProfileModal(false)}
                className="absolute top-4 right-4 text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-white text-black flex items-center justify-center p-2.5 shadow-lg border border-zinc-200 flex-shrink-0">
                  <NikeSwoosh className="w-9 h-9 fill-black" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold text-white tracking-tight">Nike UK Direct</h3>
                    <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Shopify Plus
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">Flagship Enterprise Direct-to-Consumer Store</p>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 text-xs text-[#202223]">
              {/* Account Credentials */}
              <div className="grid grid-cols-2 gap-3 bg-[#f6f6f7] p-3.5 rounded-xl border border-[#e1e3e5]">
                <div>
                  <div className="text-[10px] uppercase font-bold text-[#6d7175]">Merchant Profile</div>
                  <div className="font-bold text-[#202223] mt-0.5 text-[13px]">Nike Operations</div>
                  <div className="text-[#6d7175] font-mono text-[11px]">operations@nike-direct-uk.com</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-[#6d7175]">Store Domain</div>
                  <div className="font-bold text-[#202223] mt-0.5 text-[13px]">nike-direct.co.uk</div>
                  <div className="text-[#6d7175] font-mono text-[11px]">nike-uk.myshopify.com</div>
                </div>
              </div>

              {/* Fulfilment & Carrier Infrastructure */}
              <div>
                <div className="font-bold text-[#202223] mb-2 flex items-center gap-1.5 text-[13px]">
                  <Truck className="w-4 h-4 text-[#5c5f62]" />
                  <span>Logistics & Fulfillment Hubs</span>
                </div>
                <div className="space-y-2">
                  <div className="p-2.5 rounded-lg border border-red-200 bg-red-50/70 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-red-950">Leeds Royal Mail Hub (North England)</div>
                      <div className="text-[11px] text-red-800">Conveyor breakdown · 38 parcels held · Normal actively mitigating</div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-red-600 text-white rounded">DELAYED</span>
                  </div>

                  <div className="p-2.5 rounded-lg border border-[#e1e3e5] bg-white flex items-center justify-between">
                    <div>
                      <div className="font-medium text-[#202223]">London South Hub (Thames Gateway)</div>
                      <div className="text-[11px] text-[#6d7175]">Operating nominal · 99.4% on-time rate</div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded">HEALTHY</span>
                  </div>
                </div>
              </div>

              {/* Connected Integrations */}
              <div>
                <div className="font-bold text-[#202223] mb-2 flex items-center gap-1.5 text-[13px]">
                  <Bot className="w-4 h-4 text-[#5c5f62]" />
                  <span>Agentic & Marketing Connections</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-lg border border-[#e1e3e5] bg-white">
                    <div className="font-bold text-[#202223]">Normal Operations</div>
                    <div className="text-[11px] text-emerald-700 font-medium">Autonomous Loop Active</div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#e1e3e5] bg-white">
                    <div className="font-bold text-[#202223]">Meta Ads Manager</div>
                    <div className="text-[11px] text-amber-700 font-medium">Budget Throttled (£30/d)</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-[#f6f6f7] px-6 py-3.5 border-t border-[#e1e3e5] flex items-center justify-between">
              <a
                href="/store?ops=1"
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-semibold text-sky-700 hover:underline flex items-center gap-1"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Preview Nike Storefront ↗</span>
              </a>
              <button
                onClick={() => setShowNikeProfileModal(false)}
                className="px-4 py-1.5 bg-[#1a1a1a] text-white rounded-lg text-xs font-semibold hover:bg-zinc-800 transition-colors shadow-sm cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SHOPIFY SIDEKICK DRAWER */}
      {showSidekickDrawer && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end animate-in fade-in">
          <div className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col p-6 animate-in slide-in-from-right duration-200">
            <div className="flex justify-between items-center pb-4 border-b border-[#ebebeb]">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-purple-600 to-sky-500 p-0.5 flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-white" />
                </div>
                <h3 className="font-bold text-sm text-[#202223]">Shopify Sidekick</h3>
              </div>
              <button
                onClick={() => setShowSidekickDrawer(false)}
                className="text-zinc-500 hover:text-zinc-800 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 py-4 space-y-4 overflow-y-auto text-xs">
              <div className="bg-[#f6f6f7] p-3 rounded-lg border border-[#e1e3e5]">
                <p className="font-semibold text-[#202223]">Normal Operations Agent Update:</p>
                <p className="mt-1 text-[#4a4a4a]">
                  Root cause identified: Royal Mail Leeds Hub conveyor sensor malfunction. 38 parcels delayed past promised 48-hour delivery window.
                </p>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-lg text-emerald-800">
                <p className="font-semibold flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>3 Actions Automatically Taken:</span>
                </p>
                <ul className="mt-2 space-y-1 list-disc pl-4 text-[11px]">
                  <li>Delivery notice added to storefront checkout</li>
                  <li>Meta daily ad budget throttled from £50 to £30</li>
                  <li>Proactive notification emails sent to all 38 customers</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-2 left-4 z-40 bg-white border border-zinc-300 rounded px-3 py-1 text-xs text-zinc-700">Synthetic Shopify intro demo · no live connection</div>
      {/* POLARIS TOAST NOTIFICATION */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#202223] text-white px-4 py-2.5 rounded-lg shadow-xl text-xs font-medium flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="text-zinc-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
