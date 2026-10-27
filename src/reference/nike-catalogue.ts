import { ReferenceProduct, type ReferenceProductT } from "@/reference/schemas";

/**
 * Cached, verified Nike UK public catalogue.
 *
 * Every record below was observed verbatim on the cited nike.com/gb page via an
 * automated HTTP GET on 2026-10-24 (no bot restriction was encountered; no
 * access control was bypassed). Prices are the public list prices shown at that
 * time and may change. Nike has not authorised or connected to this project.
 *
 * This file is the offline fallback: the simulator runs from it when MongoDB has
 * not yet been seeded or public pages are unavailable.
 */
const RETRIEVED_AT = "2026-10-24T00:00:00.000Z";
const METHOD = "automated HTTP GET of public nike.com/gb page; verbatim listing text";

const row = (
  referenceProductId: string, name: string, subtitle: string,
  category: ReferenceProductT["category"], observedPriceMinor: number,
  styleCode: string, sourceUrl: string, imageUrl?: string, description?: string,
): ReferenceProductT => ReferenceProduct.parse({
  referenceProductId, name, subtitle, category, observedPriceMinor, currency: "GBP", styleCode,
  sourceUrl, sourceSite: "nike.com/gb", dataOrigin: "official_public", retrievedAt: RETRIEVED_AT,
  retrievalMethod: METHOD, verification: "verified_verbatim",
  ...(imageUrl ? { imageUrl } : {}), ...(description ? { description } : {}),
});

const IMG = "https://static.nike.com/a/images/t_web_pw_592_v2/f_auto/u_9ddf04c7-2a9a-4d76-add1-d15af8f0263d,c_scale,fl_relative,w_1.0,h_1.0,fl_layer_apply/";

export const NIKE_REFERENCE_CATALOGUE: readonly ReferenceProductT[] = [
  // Running
  row("ref_nike_pegasus_42", "Nike Pegasus 42", "Men's Road Running Shoes", "running", 12999, "IB1873-402",
    "https://www.nike.com/gb/t/pegasus-42-mens-road-running-shoes-M9ckDyR3/IB1873-402"),
  row("ref_nike_vomero_18", "Nike Vomero 18", "Men's Road Running Shoes", "running", 14499, "HM6803-005",
    "https://www.nike.com/gb/t/vomero-18-mens-road-running-shoes-SMtmxlKz/HM6803-005"),
  row("ref_nike_pegasus_plus_2", "Nike Pegasus Plus 2", "Men's Road Running Shoes", "running", 15499, "IM2541-101",
    "https://www.nike.com/gb/t/pegasus-plus-2-mens-road-running-shoes-bVq2jMv5/IM2541-101"),
  row("ref_nike_quest_7", "Nike Quest 7", "Men's Road Running Shoes", "running", 7499, "IM6368-001",
    "https://www.nike.com/gb/t/quest-7-mens-road-running-shoes-R6dnTZx6/IM6368-001"),
  // Basketball
  row("ref_nike_ja_4_nightmare", "Ja 4 'Nightmare'", "Basketball Shoes", "basketball", 11999, "IM4135-405",
    "https://www.nike.com/gb/t/ja-4-nightmare-basketball-shoes-O1MlsSTs/IM4135-405",
    `${IMG}4faaad0f-02b0-483f-ba8a-35036ac8b8f2/JA+4.png`),
  row("ref_nike_giannis_freak_8", "Giannis Freak 8 'Etched in Stone'", "Basketball Shoes", "basketball", 11499, "IR0238-002",
    "https://www.nike.com/gb/t/giannis-freak-8-etched-in-stone-basketball-shoes-UnMjh9X7/IR0238-002",
    `${IMG}84e7f6ae-6476-4e9b-b442-8ec37ec7381b/GIANNIS+FREAK+8+LX.png`),
  row("ref_nike_kobe_ad_protro", "Kobe A.D. Protro", "Basketball Shoes", "basketball", 13499, "IO8233-500",
    "https://www.nike.com/gb/t/kobe-ad-protro-basketball-shoes-N0qKeqfm/IO8233-500",
    `${IMG}a4166b1c-3887-4023-b35a-a95940ebba63/KOBE+AD+PROTRO.png`),
  // Lifestyle
  row("ref_nike_air_force_1_07", "Nike Air Force 1 '07", "Men's Shoes", "lifestyle", 10999, "CT2302-100",
    "https://www.nike.com/gb/t/air-force-1-07-shoe-E5NnNyBr/CT2302-100",
    "https://static.nike.com/a/images/t_PDP_144_v1/f_auto,q_auto:eco,u_9ddf04c7-2a9a-4d76-add1-d15af8f0263d,c_scale,fl_relative,w_1.0,h_1.0,fl_layer_apply/a42a5d53-2f99-4e78-a081-9d07a2d0774a/AIR+FORCE+1+%2707.png",
    "Nike's description (paraphrased): a basketball icon with crisp leather, bold colours and Nike Air cushioning in a low-cut, streamlined look."),
  row("ref_nike_dunk_low_retro", "Nike Dunk Low Retro", "Men's Shoes", "lifestyle", 10999, "IX7260-133",
    "https://www.nike.com/gb/t/dunk-low-retro-mens-shoes-1fXTLnJI/IX7260-133",
    `${IMG}6ee93a16-c214-471a-b20e-cf25f5775571/NIKE+DUNK+LOW+RETRO.png`),
  row("ref_nike_air_max_90", "Nike Air Max 90", "Men's Shoes", "lifestyle", 14499, "FQ2377-001",
    "https://www.nike.com/gb/t/air-max-90-mens-shoes-S5wGk8/FQ2377-001",
    "https://static.nike.com/a/images/t_web_pw_592_v2/f_auto/2311adcf-4695-4bbe-bbe3-70b1f4c0cffb/NIKE+AIR+MAX+90.png"),
  row("ref_nike_p_6000", "Nike P-6000", "Shoes", "lifestyle", 10999, "IX6221-101",
    "https://www.nike.com/gb/t/p-6000-shoes-kAwc1Ns8/IX6221-101",
    `${IMG}61cfc2cc-ec43-4a68-87ae-6dfd415a25fe/NIKE+P-6000+ESS.png`),
  // Football
  row("ref_nike_mercurial_vapor_17_elite", "Nike Mercurial Vapor 17 Elite", "Firm-Ground Low-Top Football Boot", "football", 24499, "IF8508-102",
    "https://www.nike.com/gb/t/mercurial-vapor-17-elite-firm-ground-low-top-football-boots-Qg9ZBlyn/IF8508-102",
    `${IMG}007d54db-bd1c-41c1-84aa-79994b54af82/VAPOR+17+ELITE+FG.png`),
  row("ref_nike_phantom_6_low_elite", "Nike Phantom 6 Low Elite", "Firm-Ground Football Boot", "football", 24499, "HJ2146-100",
    "https://www.nike.com/gb/t/phantom-6-low-elite-firm-ground-football-boot-vPs0Q9v9/HJ2146-100",
    `${IMG}b253c634-7d65-42cc-85f1-a803c48f18f1/PHANTOM+6+LOW+ELITE+FG.png`),
  row("ref_nike_mercurial_superfly_11_academy", "Nike Mercurial Superfly 11 Academy", "Multi-Ground High-Top Football Boot", "football", 8499, "IO1485-102",
    "https://www.nike.com/gb/t/mercurial-superfly-11-academy-multi-ground-high-top-football-boots-QIsaJWl5/IO1485-102",
    `${IMG}da30554e-9e0c-4d00-a4f9-afa5fa09ac5c/SUPERFLY+11+ACADEMY+FG%2FMG.png`),
  // Apparel
  row("ref_nike_tech_essentials_hoodie", "Nike Sportswear Tech Essentials", "Men's Full-Zip Fleece Hoodie", "apparel", 7999, "DD5284-002",
    "https://www.nike.com/gb/t/sportswear-tech-essentials-mens-full-zip-fleece-hoodie-oHBVk1hW/DD5284-002",
    `${IMG}9b3adca5-2ea6-42f1-9eea-87da2804e175/M+NSW+TE+FZ+FLC+HOODIE.png`),
  row("ref_nike_sportswear_tshirt", "Nike Sportswear", "Men's T-Shirt", "apparel", 4499, "IM5670-010",
    "https://www.nike.com/gb/t/sportswear-mens-t-shirt-RlYJjnWP/IM5670-010",
    `${IMG}82d76aeb-139f-4188-a8ad-27230f565792/M+NSW+TEE+LSE+WILD.png`),
  row("ref_nike_hyverse_top", "Nike Hyverse", "Men's Dri-FIT UV Short-sleeve Versatile Top", "apparel", 3799, "DV9839-010",
    "https://www.nike.com/gb/t/hyverse-mens-dri-fit-uv-short-sleeve-versatile-top-yNoHIsud/DV9839-010",
    `${IMG}5b962ee5-94ae-4653-a882-0962ecc0797a/M+NK+DF+UV+HYVERSE+SS.png`),
];

export function findReferenceProduct(referenceProductId: string): ReferenceProductT | undefined {
  return NIKE_REFERENCE_CATALOGUE.find((p) => p.referenceProductId === referenceProductId);
}
