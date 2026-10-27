"use client";

import { useRun } from "@/components/normal/run-context";
import type { StoreCatalogue, StoreOrder } from "@/components/store/types";
import {
Check,
ChevronDown,
ChevronLeft,
ChevronRight,
Heart,
Minus,
Plus,
Search,
ShoppingBag,
SlidersHorizontal,
Trash2,
X
} from "lucide-react";
import { useCallback,useEffect,useMemo,useState } from "react";
import { ProductImage } from "./ProductImage";

type Banner = {
  bannerId: string;
  message: string;
  active: boolean;
  startsAt: string;
  expiresAt: string;
  publishedAt: string;
};

type Publication = {
  occurredAt: string;
  planId: string;
  actionId: string;
  bannerId: string;
};

interface ShoeColorway {
  name: string;
  img: string;
}

interface ShoeProduct {
  id: string;
  title: string;
  subtitle: string;
  category: "running" | "lifestyle" | "basketball" | "football" | "apparel";
  price: number;
  badge?: "Just In" | "Bestseller" | "Sustainable Materials" | "Member Product";
  colorways: ShoeColorway[];
  isAnomalyRelated?: boolean;
  stockLevel?: number;
  description?: string;
  sourceUrl?: string;
}

interface CartItem {
  cartId: string;
  productId: string;
  title: string;
  subtitle: string;
  img: string;
  price: number;
  size: string;
  quantity: number;
}

const PROMO_MESSAGES = ["Unaffiliated Nike simulation", "Browse the recorded Nike catalogue", "Synthetic checkout — no payment required"];

export default function NikeStorePage() { const {runId}=useRun(); return <NikeStoreContent key={runId}/>; }
function NikeStoreContent() {
  const {businessId,runId,withRun}=useRun();
  const [catalogue,setCatalogue]=useState<StoreCatalogue|null>(null);
  const [checkoutBusy,setCheckoutBusy]=useState(false);
  const [orderMessage,setOrderMessage]=useState('');
  const [checkoutKey,setCheckoutKey]=useState('');
  const [orders,setOrders]=useState<StoreOrder[]>([]);
  const orderStorageKey=`normal.nike.orders.v1:${businessId}:${runId}`;
  const NIKE_PRODUCTS:ShoeProduct[]=useMemo(()=>(catalogue?.products??[]).filter(p=>p.active).map(p=>({id:p.productId,title:p.name,subtitle:p.subtitle,category:p.category as ShoeProduct['category'],price:p.priceMinor/100,stockLevel:p.availableUnits,isAnomalyRelated:p.availableUnits<=10,description:p.reference?.description,sourceUrl:p.reference?.sourceUrl,colorways:p.images.length?p.images.map(i=>({name:i.alt,img:i.src})):[{name:'Image unavailable',img:'/assets/product-unavailable.svg'}]})),[catalogue]);

  const [banners, setBanners] = useState<Banner[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [error, setError] = useState("");
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("featured");
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [priceFilter, setPriceFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [addedItemName, setAddedItemName] = useState<string | null>(null);
  const [activeColorwayIndex, setActiveColorwayIndex] = useState<Record<string, number>>({});

  // Modals & Drawers
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isWishlistOpen, setIsWishlistOpen] = useState(false);
  const [sizeModalProduct, setSizeModalProduct] = useState<ShoeProduct | null>(null);
  const [selectedSize] = useState<string>("Standard — sizes not modelled");
  const [promoIndex, setPromoIndex] = useState(0);

  const isOpsMode = true;
  const loadOrders=useCallback(async()=>{
    if(!runId)return;
    let keys:string[]=[];
    try{const saved=JSON.parse(localStorage.getItem(orderStorageKey)??'[]');if(Array.isArray(saved))keys=saved.filter((key):key is string=>typeof key==='string'&&key.length>=8).slice(0,20);}catch{return;}
    if(!keys.length)return;
    const response=await fetch(`/api/demo-store/orders?${new URLSearchParams({businessId,simulationRunId:runId,keys:keys.join(',')})}`,{cache:'no-store'});
    if(response.ok)setOrders((await response.json()).orders);
  },[businessId,runId,orderStorageKey]);
  const load = useCallback(async () => {
    if(!runId)return;
    const r=await fetch(`/api/demo-store/products?${new URLSearchParams({businessId,simulationRunId:runId})}`,{cache:'no-store'});
    const b=await r.json();if(!r.ok)throw new Error(b.error?.message??'Catalogue unavailable');
    setCatalogue(b);setBanners((b.banners??[]).map((v:Banner)=>({...v,active:true})));setPublications([]);setError('');
  },[businessId,runId]);
  useEffect(()=>{let live=true;const poll=()=>{if(live)void load().catch(e=>{if(live)setError(String(e))})};
    void Promise.resolve().then(()=>{if(live){setCatalogue(null);setCartItems([]);setSizeModalProduct(null);setOrderMessage('');setCheckoutKey(crypto.randomUUID());poll();void loadOrders().catch(()=>{})}});
    const t=setInterval(poll,15000);return()=>{live=false;clearInterval(t)};
  },[load,loadOrders]);
  async function placeOrder(){
    if(!runId||checkoutBusy||!cartItems.length)return;setCheckoutBusy(true);setError('');
    try{const r=await fetch('/api/demo-store/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId,simulationRunId:runId,idempotencyKey:checkoutKey,items:cartItems.map(i=>({productId:i.productId,quantity:i.quantity}))})});
      const b=await r.json();if(!r.ok)throw new Error(b.message??b.error?.message??'Checkout failed');
      setOrders(previous=>[b.order,...previous.filter(order=>order.orderId!==b.order.orderId)].slice(0,20));
      try{const saved=JSON.parse(localStorage.getItem(orderStorageKey)??'[]');const keys=Array.isArray(saved)?saved.filter((key):key is string=>typeof key==='string'):[];localStorage.setItem(orderStorageKey,JSON.stringify([checkoutKey,...keys.filter(key=>key!==checkoutKey)].slice(0,20)));}catch{/* Purchase receipts remain available for this visit when storage is disabled. */}
      setOrderMessage(`Order ${b.order.orderId} persisted · £${(b.order.netRevenueMinor/100).toFixed(2)} · ${b.order.status}`);setCartItems([]);setIsCartOpen(false);setCheckoutKey(crypto.randomUUID());await load();
    }catch(e){setError((e as Error).message)}finally{setCheckoutBusy(false)}
  }

  const totalCartCount = useMemo(() => {
    return cartItems.reduce((acc, item) => acc + item.quantity, 0);
  }, [cartItems]);

  const cartSubtotal = useMemo(() => {
    return cartItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
  }, [cartItems]);

  const toggleFavorite = (id: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleQuickAdd = (product: ShoeProduct, size = "Standard — sizes not modelled") => {
    if(!product.stockLevel){setError('This product is out of stock.');return;}
    setCheckoutKey(crypto.randomUUID());
    const activeColorIdx = activeColorwayIndex[product.id] ?? 0;
    const activeImg = product.colorways[activeColorIdx]?.img || product.colorways[0].img;
    const cartId = product.id;

    setCartItems((prev) => {
      const existing = prev.find((i) => i.cartId === cartId);
      if (existing) {
        return prev.map((i) =>
          i.cartId === cartId ? { ...i, quantity: Math.min(5, product.stockLevel ?? 0, i.quantity + 1) } : i
        );
      }
      return [
        ...prev,
        {
          cartId,
          productId: product.id,
          title: product.title,
          subtitle: product.subtitle,
          img: activeImg,
          price: product.price,
          size,
          quantity: 1
        }
      ];
    });

    setAddedItemName(`${product.title} (${size})`);
    setTimeout(() => setAddedItemName(null), 3000);
    setSizeModalProduct(null);
  };

  const updateCartQuantity = (cartId: string, delta: number) => {
    setCheckoutKey(crypto.randomUUID());
    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.cartId === cartId) {
            const nextQty = Math.min(5, NIKE_PRODUCTS.find(p=>p.id===item.productId)?.stockLevel??0, item.quantity + delta);
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeCartItem = (cartId: string) => {
    setCheckoutKey(crypto.randomUUID());
    setCartItems((prev) => prev.filter((item) => item.cartId !== cartId));
  };

  const activeBanners = banners; // Server already evaluates against the selected simulation clock.

  const filteredProducts = useMemo(() => {
    let list = [...NIKE_PRODUCTS];

    if (selectedCategory !== "all") {
      list = list.filter((p) => p.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(q) || p.subtitle.toLowerCase().includes(q));
    }

    if (priceFilter === "under100") {
      list = list.filter((p) => p.price < 100);
    } else if (priceFilter === "100to150") {
      list = list.filter((p) => p.price >= 100 && p.price <= 150);
    } else if (priceFilter === "over150") {
      list = list.filter((p) => p.price > 150);
    }

    if (sortBy === "priceAsc") {
      list.sort((a, b) => a.price - b.price);
    } else if (sortBy === "priceDesc") {
      list.sort((a, b) => b.price - a.price);
    } else if (sortBy === "newest") {
      list.sort((a, b) => (b.badge === "Just In" ? 1 : 0) - (a.badge === "Just In" ? 1 : 0));
    }

    return list;
  }, [selectedCategory, searchQuery, priceFilter, sortBy, NIKE_PRODUCTS]);

  const favoritedProducts = useMemo(() => {
    return NIKE_PRODUCTS.filter((p) => favoriteIds.has(p.id));
  }, [favoriteIds, NIKE_PRODUCTS]);

  return (
    <div className="partner-store min-h-screen bg-white text-[#111111] font-sans antialiased flex flex-col selection:bg-[#111111] selection:text-white">
      <div className="bg-black text-white px-12 py-2 text-xs flex justify-between"><a href={withRun('/dashboard')}>← Normal overview</a><span>Unaffiliated Nike simulation · {runId}</span><a href={withRun('/dashboard/approvals')}>Approvals</a></div>
      {orderMessage&&<div role="status" className="bg-emerald-50 p-4 text-emerald-800">{orderMessage}</div>}
      {error&&<div role="alert" className="bg-red-50 p-4 text-red-800">{error}</div>}
      {orders.length>0&&<section data-testid="your-orders" aria-label="Your simulated orders" className="border-b border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><h2 className="font-semibold">Your simulated orders</h2><p>No payment was taken. These receipts are saved in the selected simulation.</p>{orders.map(order=><div key={order.orderId} data-testid="order-confirmation" className="mt-2"><strong>{order.orderId}</strong><span> · {order.lines.map(line=>`${line.quantity}× ${line.name}`).join(', ')} · £{(order.netRevenueMinor/100).toFixed(2)}</span></div>)}</section>}
      {!catalogue&&!error&&<p className="p-6">Loading MongoDB catalogue…</p>}
      {/* 1. Global Utility Sub-Brand Bar */}
      <div className="bg-[#f5f5f5] px-12 h-9 hidden md:flex justify-between items-center text-[12px] text-[#111111] font-medium border-b border-[#e5e5e5]">
        <div className="flex items-center gap-7">
          {/* Jordan Jumpman Icon */}
          <a aria-disabled="true" className="hover:opacity-70 transition-opacity" title="Jordan">
            <svg
              className="w-4 h-4 fill-current"
              width="16"
              height="16"
              style={{ width: "16px", height: "16px", maxWidth: "16px", maxHeight: "16px", display: "block" }}
              viewBox="0 0 24 24"
            >
              <path d="M18.8 2.2c-.3 0-.6.1-.8.3l-2.4 2.5-2-1.9c-.3-.3-.7-.4-1.1-.3-.4.1-.7.4-.8.8l-.8 3.2-3.1 1.7c-.4.2-.6.6-.6 1 0 .2.1.5.2.7l3.8 4.7-1.4 5.3c-.1.5.1 1 .6 1.2.2.1.4.1.6.1.3 0 .6-.1.8-.3l6.5-6.5c.3-.3.4-.7.3-1.1-.1-.4-.4-.7-.8-.8l-3.3-.8 1.4-4.8 2.6 1.6c.2.1.5.2.7.2.5 0 1-.3 1.2-.8.2-.5 0-1.1-.4-1.4l-3.2-2.3 2.1-2.2c.5-.5.5-1.3 0-1.8-.3-.2-.6-.4-.9-.4z"/>
            </svg>
          </a>
          {/* Converse Star Chevron */}
          <a aria-disabled="true" className="hover:opacity-70 transition-opacity" title="Converse">
            <svg
              className="w-4 h-4 fill-current"
              width="16"
              height="16"
              style={{ width: "16px", height: "16px", maxWidth: "16px", maxHeight: "16px", display: "block" }}
              viewBox="0 0 24 24"
            >
              <path d="M12 2l2.4 7.4h7.6l-6.2 4.5 2.4 7.4-6.2-4.5-6.2 4.5 2.4-7.4-6.2-4.5h7.6z"/>
            </svg>
          </a>
        </div>

        {/* Consumer Utility Links */}
        <div className="flex items-center gap-3 text-[12px] text-[#111111]">
          {isOpsMode && (
            <>
              <a href="/shopify" className="text-emerald-700 font-bold hover:underline flex items-center gap-1">
                <span>Shopify Admin ↗</span>
              </a>
              <span className="text-[#ccc]">|</span>
              <a href={withRun("/dashboard")} className="text-sky-600 font-bold hover:underline flex items-center gap-1">
                <span>← Back to Operations Cockpit</span>
              </a>
              <span className="text-[#ccc]">|</span>
            </>
          )}
          <a aria-disabled="true" title="Not available in this simulation" className="hover:text-black">Find a Store</a>
          <span className="text-[#ccc]">|</span>
          <a aria-disabled="true" title="Not available in this simulation" className="hover:text-black">Help</a>
          <span className="text-[#ccc]">|</span>
          <a aria-disabled="true" title="Not available in this simulation" className="hover:text-black">Join Us</a>
          <span className="text-[#ccc]">|</span>
          <a aria-disabled="true" title="Not available in this simulation" className="hover:text-black">Sign In</a>
        </div>
      </div>

      {/* 2. Main Nike Navigation Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-[#e5e5e5] px-4 sm:px-12 h-16 flex items-center justify-between">
        {/* Nike Official Swoosh SVG */}
        <a href={withRun("/demo-store")} className="flex-shrink-0" title="Nike Home">
          <svg
            className="w-16 h-8 text-black fill-current"
            width="60"
            height="30"
            style={{ width: "60px", height: "30px", maxWidth: "60px", maxHeight: "30px", display: "block" }}
            viewBox="0 0 24 24"
          >
            <path fillRule="evenodd" d="M21 8.719L7.836 14.303C6.74 14.768 5.818 15 5.075 15c-.836 0-1.445-.295-1.819-.884-.485-.76-.273-1.982.559-3.272.494-.754 1.122-1.446 1.734-2.108-.144.234-1.415 2.349-.025 3.345.275.2.666.298 1.147.298.386 0 .829-.063 1.316-.19L21 8.719z" clipRule="evenodd" />
          </svg>
        </a>

        {/* Primary Nav Links */}
        <nav className="hidden md:flex items-center gap-8 text-[16px] font-medium text-[#111111]">
          <button
            onClick={() => setSelectedCategory("all")}
            className={`hover:opacity-70 transition-opacity cursor-pointer ${selectedCategory === "all" ? "font-bold border-b-2 border-black" : ""}`}
          >
            New
          </button>
          <button
            onClick={() => setSelectedCategory("lifestyle")}
            className={`hover:opacity-70 transition-opacity cursor-pointer ${selectedCategory === "lifestyle" ? "font-bold border-b-2 border-black" : ""}`}
          >
            Lifestyle
          </button>
          <button
            onClick={() => setSelectedCategory("running")}
            className={`hover:opacity-70 transition-opacity cursor-pointer ${selectedCategory === "running" ? "font-bold border-b-2 border-black" : ""}`}
          >
            Running
          </button>
          <button
            onClick={() => setSelectedCategory("apparel")}
            className={`hover:opacity-70 transition-opacity cursor-pointer ${selectedCategory === "apparel" ? "font-bold border-b-2 border-black" : ""}`}
          >
            Apparel
          </button>
          <button
            onClick={() => setSelectedCategory("football")}
            className={`hover:opacity-70 transition-opacity cursor-pointer ${selectedCategory === "football" ? "font-bold border-b-2 border-black" : ""}`}
          >
            Football
          </button>
          <button onClick={()=>setSelectedCategory("basketball")} className="hover:opacity-70 transition-opacity font-semibold">
            Basketball
          </button>
        </nav>

        {/* Right Utility: Search & Icons */}
        <div className="flex items-center gap-2 sm:gap-4">
          <form role="search" className="relative" onSubmit={event=>event.preventDefault()}>
            <input
              type="text"
              placeholder="Search"
              aria-label="Search products"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-32 sm:w-48 bg-[#f5f5f5] hover:bg-[#e5e5e5] focus:bg-white text-[14px] text-[#111111] rounded-full pl-10 pr-4 py-2 outline-none border border-transparent focus:border-zinc-300 transition-all placeholder:text-[#707072]"
            />
            <Search className="w-4 h-4 text-[#111111] absolute left-3.5 top-1/2 -translate-y-1/2" />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-black cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </form>

          {/* Favorites Button */}
          <button
            onClick={() => setIsWishlistOpen(true)}
            className="p-1.5 hover:opacity-70 transition-opacity relative cursor-pointer"
            title="Favorites"
          >
            <Heart className={`w-6 h-6 ${favoriteIds.size > 0 ? "fill-red-500 text-red-500" : "text-[#111111]"}`} />
            {favoriteIds.size > 0 && (
              <span className="absolute -top-1 -right-1 bg-black text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                {favoriteIds.size}
              </span>
            )}
          </button>

          {/* Bag Button */}
          <button
            onClick={() => setIsCartOpen(true)}
            className="p-1.5 hover:opacity-70 transition-opacity relative cursor-pointer"
            title="Bag"
          >
            <ShoppingBag className="w-6 h-6 text-[#111111]" />
            {totalCartCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-black text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                {totalCartCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* 3. Free Delivery Promo Strip (Interactive Carousel) */}
      <div className="bg-[#f5f5f5] py-2 px-12 text-center text-[12px] text-[#111111] font-medium border-b border-[#e5e5e5] flex items-center justify-center gap-4">
        <button
          onClick={() =>
            setPromoIndex((prev) => (prev === 0 ? PROMO_MESSAGES.length - 1 : prev - 1))
          }
          className="text-[#111111] hover:opacity-70 cursor-pointer p-1"
          title="Previous notice"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <p className="min-h-[18px] transition-all">
          {PROMO_MESSAGES[promoIndex]}
        </p>
        <button
          onClick={() =>
            setPromoIndex((prev) => (prev === PROMO_MESSAGES.length - 1 ? 0 : prev + 1))
          }
          className="text-[#111111] hover:opacity-70 cursor-pointer p-1"
          title="Next notice"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 4. Official Customer Announcement Banner */}
      {activeBanners.map((b) => {
        const pub = publications
          .filter((p) => p.bannerId === b.bannerId)
          .sort((x, y) => y.occurredAt.localeCompare(x.occurredAt))[0];

        return (
          <aside
            key={b.bannerId}
            data-testid="storefront-banner"
            role="status"
            className="bg-[#111111] text-white py-2.5 px-12 text-center text-[13px] font-medium transition-all"
          >
            <div className="max-w-[1920px] mx-auto flex items-center justify-center relative">
              <p className="tracking-tight">
                <strong>Notice:</strong> {b.message}
              </p>

              {isOpsMode && pub && (
                <div className="absolute right-0 hidden lg:flex items-center gap-2 bg-zinc-800 border border-zinc-700 px-2 py-0.5 rounded text-[11px] text-zinc-300 font-mono">
                  <span>Backend Action: {pub.planId}</span>
                </div>
              )}
            </div>
          </aside>
        );
      })}

      {/* Added to Bag Toast Notification */}
      {addedItemName && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#111111] text-white px-5 py-3 rounded-lg shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5">
          <Check className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-medium">Added &ldquo;{addedItemName}&rdquo; to your bag</span>
          <button
            onClick={() => setIsCartOpen(true)}
            className="ml-3 underline text-xs font-bold hover:text-zinc-300"
          >
            View Bag
          </button>
        </div>
      )}

      {/* 5. Main PLP View */}
      <main className="px-4 sm:px-12 py-7 w-full min-w-0 flex-1 max-w-[1920px] mx-auto">
        {/* Category Header Row with Interactive Sort By Dropdown */}
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between pb-4 mb-4 relative">
          <h1 className="text-[24px] font-medium text-[#111111]">
            Nike catalogue ({filteredProducts.length})
          </h1>

          <div className="flex items-center gap-6 text-[15px] font-medium text-[#111111]">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 hover:opacity-70 transition-opacity cursor-pointer"
            >
              <span>{showFilters ? "Hide Filters" : "Show Filters"}</span>
              <SlidersHorizontal className="w-4 h-4" />
            </button>

            {/* Sort By Dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsSortOpen(!isSortOpen)}
                className="flex items-center gap-1 cursor-pointer hover:opacity-70 py-1"
              >
                <span>
                  Sort By:{" "}
                  <strong>
                    {sortBy === "featured"
                      ? "Featured"
                      : sortBy === "newest"
                      ? "Newest"
                      : sortBy === "priceAsc"
                      ? "Price: Low-High"
                      : "Price: High-Low"}
                  </strong>
                </span>
                <ChevronDown className="w-4 h-4" />
              </button>

              {isSortOpen && (
                <div className="absolute right-0 top-8 w-48 bg-white border border-[#e5e5e5] rounded shadow-xl z-30 py-2 text-sm">
                  {[
                    { id: "featured", label: "Featured" },

                    { id: "priceAsc", label: "Price: Low to High" },
                    { id: "priceDesc", label: "Price: High to Low" }
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setSortBy(opt.id);
                        setIsSortOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-[#f5f5f5] flex items-center justify-between"
                    >
                      <span className={sortBy === opt.id ? "font-bold text-black" : "text-[#707072]"}>
                        {opt.label}
                      </span>
                      {sortBy === opt.id && <Check className="w-4 h-4 text-black" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Two-Column Layout */}
        <div className="flex gap-12 items-start">
          {/* Left Category & Filter Sidebar (Collapsible) */}
          {showFilters && (
            <aside className="w-[240px] flex-shrink-0 hidden md:block space-y-6 sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-4">
              {/* Vertical Category Links */}
              <div className="space-y-3 text-[15px] font-medium text-[#111111] border-b border-[#e5e5e5] pb-6">
                {[
                  { id: "all", label: "All products" },
                  { id: "lifestyle", label: "Lifestyle" },
                  { id: "basketball", label: "Basketball" },
                  { id: "running", label: "Running" },
                  { id: "football", label: "Football" },
                  { id: "apparel", label: "Apparel" }
                ].map((cat) => (
                  <button
                    key={cat.label}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`block w-full text-left hover:text-[#707072] transition-colors cursor-pointer ${
                      selectedCategory === cat.id ? "font-bold text-black" : "text-[#111111]"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Accordion Filter: Shop By Price */}
              <div className="border-b border-[#e5e5e5] pb-5">
                <div className="flex justify-between items-center font-medium text-[15px] mb-3">
                  <span>Shop By Price</span>
                </div>
                <div className="space-y-2 text-[14px] text-[#111111]">
                  {[
                    { id: "all", label: "All Prices" },
                    { id: "under100", label: "Under £100" },
                    { id: "100to150", label: "£100 - £150" },
                    { id: "over150", label: "Over £150" }
                  ].map((tier) => (
                    <label key={tier.id} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="priceRadio"
                        checked={priceFilter === tier.id}
                        onChange={() => setPriceFilter(tier.id)}
                        className="w-4 h-4 accent-black"
                      />
                      <span>{tier.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Shoe Size Selection Chips */}
              <div className="border-b border-[#e5e5e5] pb-5">
                <div className="flex justify-between items-center font-medium text-[15px] mb-3">
                  <span>Size</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <p className="text-xs text-zinc-500">Sizes are not modelled.</p>
                </div>
              </div>
            </aside>
          )}

          {/* Product Cards Grid: Smooth 3 or 4 Column Dynamic Layout */}
          <div className="flex-1 min-w-0">
            <div
              className={`grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-12 ${
                showFilters ? "lg:grid-cols-3" : "lg:grid-cols-4"
              }`}
            >
              {filteredProducts.map((product) => {
                const isFav = favoriteIds.has(product.id);
                const activeColorIdx = activeColorwayIndex[product.id] ?? 0;
                const activeColorway = product.colorways[activeColorIdx] || product.colorways[0];

                return (
                  <article data-testid={`product-${product.id}`} key={product.id} className="group flex flex-col">
                    {/* Square Image Box */}
                    <div className="relative bg-[#f6f6f6] aspect-square overflow-hidden flex items-center justify-center p-4">
                      {/* Favorite Button */}
                      <button
                        onClick={() => toggleFavorite(product.id)}
                        className="absolute top-3 right-3 z-10 p-2 rounded-full bg-white/80 hover:bg-white text-zinc-800 transition-all opacity-0 group-hover:opacity-100 cursor-pointer shadow"
                        title="Save to Wishlist"
                      >
                        <Heart className={`w-4 h-4 ${isFav ? "fill-red-500 text-red-500" : ""}`} />
                      </button>

                      {/* Main Shoe Image */}
                      <ProductImage
                        src={activeColorway.img}
                        alt={product.title}
                        className="w-full h-full object-contain mix-blend-multiply transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />

                      {/* Hover Quick Add Button */}
                      <div className="absolute inset-x-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setSizeModalProduct(product)}
                          className="w-full bg-black/90 hover:bg-black text-white py-2.5 rounded-full text-[12px] font-bold uppercase tracking-wider shadow-lg flex items-center justify-center gap-1.5 transition-transform active:scale-95 cursor-pointer"
                        >
                          <ShoppingBag className="w-3.5 h-3.5" />
                          <span>Quick Add · £{product.price.toFixed(2)}</span>
                        </button>
                      </div>
                    </div>

                    {/* Colorway Miniature Thumbnails */}
                    <div className="flex items-center gap-1.5 mt-3 mb-2 min-h-[36px] overflow-x-auto">
                      {product.colorways.map((cw, idx) => (
                        <button
                          key={idx}
                          onClick={() =>
                            setActiveColorwayIndex((prev) => ({ ...prev, [product.id]: idx }))
                          }
                          onMouseEnter={() =>
                            setActiveColorwayIndex((prev) => ({ ...prev, [product.id]: idx }))
                          }
                          className={`w-8 h-8 rounded border overflow-hidden p-0.5 bg-[#f6f6f6] transition-all cursor-pointer ${
                            idx === activeColorIdx ? "border-black scale-105" : "border-[#e5e5e5] opacity-75 hover:opacity-100"
                          }`}
                          title={cw.name}
                        >
                          <ProductImage src={cw.img} alt={cw.name} className="w-full h-full object-contain mix-blend-multiply" />
                        </button>
                      ))}
                    </div>

                    {/* Badge & Urgency Indicator */}
                    <div className="flex items-center justify-between mb-0.5">
                      {product.badge && (
                        <span className="text-[15px] font-medium text-[#fa5400]">
                          {product.badge}
                        </span>
                      )}

                      {product.isAnomalyRelated && (
                        <span className="text-[12px] font-semibold text-[#b91c1c] bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                          {product.stockLevel===0?"Sold out":`${product.stockLevel} in stock`}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h2
                      onClick={() => setSizeModalProduct(product)}
                      className="text-[15px] font-medium text-[#111111] leading-snug cursor-pointer hover:underline"
                    >
                      {product.title}
                    </h2>

                    {/* Subtitle */}
                    <p className="text-[15px] text-[#707072] mt-0.5">
                      {product.subtitle}
                    </p>

                    {/* Price */}
                    <p className="text-[15px] font-medium text-[#111111] mt-2">
                      £{product.price.toFixed(2)}
                    </p>
                  </article>
                );
              })}
            </div>

            {/* In-feed Editorial Banner */}
            <div className="mt-16 bg-[#111111] text-white rounded-none overflow-hidden relative flex flex-col justify-end min-h-[380px] p-12">
              <div className="absolute inset-0 z-0 opacity-40 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-700 via-zinc-900 to-black" />
              <div className="relative z-10 max-w-xl space-y-4">
                <h3 className="text-5xl font-black uppercase tracking-tighter leading-none">
                  TRAIN EVERYTHING
                </h3>
                <p className="text-[15px] text-zinc-300 max-w-md">
                  High-performance footwear engineered for relentless workouts, turf drills, and speed intervals.
                </p>
                <div>
                  <button
                    onClick={() => setSelectedCategory("apparel")}
                    className="bg-white text-black font-bold text-[14px] px-6 py-2.5 rounded-full hover:bg-zinc-200 transition-colors cursor-pointer"
                  >
                    Shop Hybrid
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 6. Nike Global Footer */}
      <footer className="bg-[#111111] text-white mt-24 pt-16 pb-12 border-t border-zinc-800">
        <div className="max-w-[1920px] mx-auto px-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 pb-12 border-b border-zinc-800 text-sm">
            <div>
              <h4 className="font-extrabold uppercase tracking-wider text-[12px] mb-4 text-white">Resources</h4>
              <ul className="space-y-3 text-[12px] text-zinc-400 font-medium">
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">Find A Store</a></li>
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">Become A Member</a></li>
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">Send Us Feedback</a></li>
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">Student Discounts</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-extrabold uppercase tracking-wider text-[12px] mb-4 text-white">Help</h4>
              <ul className="space-y-3 text-[12px] text-zinc-400 font-medium">
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">Get Help</a></li>
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">Order Status</a></li>
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">Delivery</a></li>
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">Returns &amp; Refunds</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-extrabold uppercase tracking-wider text-[12px] mb-4 text-white">Company</h4>
              <ul className="space-y-3 text-[12px] text-zinc-400 font-medium">
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">About Nike</a></li>
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">News</a></li>
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">Careers</a></li>
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">Sustainability</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-extrabold uppercase tracking-wider text-[12px] mb-4 text-white">Promotions &amp; Discounts</h4>
              <ul className="space-y-3 text-[12px] text-zinc-400 font-medium">
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">Student Discount</a></li>
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">Military Discount</a></li>
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">Teacher Discount</a></li>
                <li><a aria-disabled="true" title="Not available in this simulation" className="hover:text-white">First Responder Discount</a></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-[12px] text-zinc-500">
            <div className="flex items-center gap-4">
              <span className="text-zinc-300 font-semibold flex items-center gap-1.5">
                <span>🇬🇧</span>
                <span>United Kingdom</span>
              </span>
              <span>© 2026 Nike, Inc. All Rights Reserved.</span>
            </div>

            <div className="flex flex-wrap gap-6">
              <a aria-disabled="true" title="Not available in this simulation" className="hover:text-zinc-300">Guides</a>
              <a aria-disabled="true" title="Not available in this simulation" className="hover:text-zinc-300">Terms of Sale</a>
              <a aria-disabled="true" title="Not available in this simulation" className="hover:text-zinc-300">Terms of Use</a>
              <a aria-disabled="true" title="Not available in this simulation" className="hover:text-zinc-300">Nike Privacy Policy</a>
            </div>
          </div>
        </div>
      </footer>

      {/* SIZE SELECTION MODAL */}
      {sizeModalProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-label={sizeModalProduct.title} data-testid="product-drawer" className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto animate-in fade-in zoom-in-95 p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-bold text-lg text-black">{sizeModalProduct.title}</h3>
                <p className="text-sm text-zinc-500">{sizeModalProduct.subtitle} · £{sizeModalProduct.price.toFixed(2)}</p>
              </div>
              <button onClick={() => setSizeModalProduct(null)} className="text-zinc-400 hover:text-black">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-6 space-y-3">
              <ProductImage src={sizeModalProduct.colorways[activeColorwayIndex[sizeModalProduct.id]??0]?.img} alt={sizeModalProduct.title} className="w-full h-52 object-contain"/>
              <div className="flex gap-2 overflow-auto">{sizeModalProduct.colorways.map((image,index)=><button key={image.img} aria-label={`View ${index+1}`} onClick={()=>setActiveColorwayIndex(v=>({...v,[sizeModalProduct.id]:index}))}><ProductImage src={image.img} alt={image.name} className="w-12 h-12 object-contain"/></button>)}</div>
              <p>{sizeModalProduct.description}</p><p className="text-sm text-zinc-500">{sizeModalProduct.stockLevel} units in stock. Inventory is tracked by product; sizes are not modelled.</p>
              <p className="text-sm text-zinc-500">Stock levels and purchases are simulated and are not Nike data. {sizeModalProduct.sourceUrl&&<a href={sizeModalProduct.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">nike.com/gb</a>}</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setSizeModalProduct(null)}
                className="w-1/3 py-3 border border-zinc-300 rounded-full font-bold text-sm hover:border-black"
              >
                Cancel
              </button>
              <button
                onClick={() => handleQuickAdd(sizeModalProduct, selectedSize)}
                disabled={!sizeModalProduct.stockLevel}
                data-testid="add-to-cart"
                className="w-2/3 py-3 bg-black hover:bg-zinc-800 text-white rounded-full font-bold text-sm shadow flex items-center justify-center gap-2"
              >
                <ShoppingBag className="w-4 h-4" />
                <span>{sizeModalProduct.stockLevel?'Add to Bag':'Sold out'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SHOPPING BAG SLIDE-OVER DRAWER */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex justify-end animate-in fade-in">
          <div role="dialog" aria-modal="true" aria-label="Bag" data-testid="cart-drawer" className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="px-6 py-5 border-b border-[#e5e5e5] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5" />
                <h3 className="font-bold text-lg text-black">Bag ({totalCartCount})</h3>
              </div>
              <button
                onClick={() => setIsCartOpen(false)}
                className="p-1 hover:bg-zinc-100 rounded-full"
              >
                <X className="w-5 h-5 text-black" />
              </button>
            </div>

            {/* Cart Items List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {cartItems.length === 0 ? (
                <div className="text-center py-16 space-y-4">
                  <ShoppingBag className="w-12 h-12 text-zinc-300 mx-auto" />
                  <p className="text-zinc-600 font-medium">There are no items in your bag.</p>
                  <button
                    onClick={() => setIsCartOpen(false)}
                    className="bg-black text-white text-xs font-bold uppercase tracking-wider px-6 py-3 rounded-full hover:bg-zinc-800"
                  >
                    Start Shopping
                  </button>
                </div>
              ) : (
                cartItems.map((item) => (
                  <div key={item.cartId} data-testid={`cart-line-${item.productId}`} className="flex gap-4 pb-6 border-b border-[#e5e5e5]">
                    <div className="w-20 h-20 bg-[#f6f6f6] rounded p-2 flex-shrink-0 flex items-center justify-center">
                      <ProductImage src={item.img} alt={item.title} className="w-full h-full object-contain mix-blend-multiply" />
                    </div>
                    <div className="flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start">
                          <h4 className="font-semibold text-sm text-black leading-snug">{item.title}</h4>
                          <span className="font-bold text-sm">£{(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                        <p className="text-xs text-zinc-500 mt-0.5">{item.subtitle}</p>
                        <p className="text-xs font-medium text-zinc-700 mt-1">Size: {item.size}</p>
                      </div>

                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center border border-zinc-300 rounded">
                          <button
                            onClick={() => updateCartQuantity(item.cartId, -1)}
                            aria-label={`Decrease ${item.title}`}
                            className="p-1 hover:bg-zinc-100 text-zinc-600"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="px-2 text-xs font-bold">{item.quantity}</span>
                          <button
                            onClick={() => updateCartQuantity(item.cartId, 1)}
                            aria-label={`Increase ${item.title}`}
                            disabled={item.quantity>=Math.min(5,NIKE_PRODUCTS.find(product=>product.id===item.productId)?.stockLevel??0)}
                            className="p-1 hover:bg-zinc-100 text-zinc-600"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>

                        <button
                          onClick={() => removeCartItem(item.cartId)}
                          className="text-zinc-400 hover:text-red-600 p-1"
                          title="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Drawer Footer Summary */}
            {cartItems.length > 0 && (
              <div className="p-6 border-t border-[#e5e5e5] bg-[#fafafa] space-y-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-zinc-600">
                    <span>Subtotal</span>
                    <span>£{cartSubtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-zinc-600">
                    <span>Estimated Delivery</span>
                    <span className="text-emerald-600 font-medium">Free</span>
                  </div>
                  <div className="flex justify-between font-bold text-base text-black pt-2 border-t border-zinc-200">
                    <span>Total</span>
                    <span>£{cartSubtotal.toFixed(2)}</span>
                  </div>
                </div>

                {error&&<p role="alert" className="text-red-700">{error}</p>}{orderMessage&&<p role="status">{orderMessage}</p>}
                <button
                  data-testid="place-order"
                  disabled={checkoutBusy || cartItems.length===0} onClick={placeOrder}
                  className="w-full bg-black hover:bg-zinc-800 text-white font-bold py-3.5 rounded-full text-sm shadow-md transition-all cursor-pointer"
                >
                  Member Checkout
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* WISHLIST SLIDE-OVER DRAWER */}
      {isWishlistOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex justify-end animate-in fade-in">
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="px-6 py-5 border-b border-[#e5e5e5] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Heart className="w-5 h-5 fill-red-500 text-red-500" />
                <h3 className="font-bold text-lg text-black">Favourites ({favoriteIds.size})</h3>
              </div>
              <button
                onClick={() => setIsWishlistOpen(false)}
                className="p-1 hover:bg-zinc-100 rounded-full"
              >
                <X className="w-5 h-5 text-black" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {favoritedProducts.length === 0 ? (
                <div className="text-center py-16 space-y-4">
                  <Heart className="w-12 h-12 text-zinc-300 mx-auto" />
                  <p className="text-zinc-600 font-medium">No items saved to your favourites yet.</p>
                </div>
              ) : (
                favoritedProducts.map((product) => (
                  <div key={product.id} className="flex gap-4 pb-6 border-b border-[#e5e5e5]">
                    <div className="w-20 h-20 bg-[#f6f6f6] rounded p-2 flex-shrink-0 flex items-center justify-center">
                      <ProductImage src={product.colorways[0].img} alt={product.title} className="w-full h-full object-contain mix-blend-multiply" />
                    </div>
                    <div className="flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start">
                          <h4 className="font-semibold text-sm text-black">{product.title}</h4>
                          <span className="font-bold text-sm">£{product.price.toFixed(2)}</span>
                        </div>
                        <p className="text-xs text-zinc-500">{product.subtitle}</p>
                      </div>

                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => {
                            handleQuickAdd(product, "UK 9");
                            setIsWishlistOpen(false);
                            setIsCartOpen(true);
                          }}
                          className="bg-black hover:bg-zinc-800 text-white text-xs font-bold px-3 py-1.5 rounded-full"
                        >
                          Move to Bag
                        </button>
                        <button
                          onClick={() => toggleFavorite(product.id)}
                          className="text-xs text-zinc-500 hover:text-red-600 underline"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
