// Display roles are separate from frozen contract agent IDs. No extra LLM workers.
export const agentRoles = [
  { id: "orchestrator", name: "Orchestrator Agent", phase: "Essential", mode: "execution", tools: ["plan.delegate"], description: "Approval checks, dependency ordering, delegation, verification and audit reporting. Interrupted attempts require review." },
  { id: "marketing", name: "Marketing Agent", phase: "MVP", mode: "execution", tools: ["ads.set_daily_budget"], description: "Reads simulated Nike campaign performance and adjusts approved daily budgets." },
  { id: "customer_care", name: "Customer Experience Agent", phase: "MVP", mode: "execution", tools: ["customer.send_delay_notice"], description: "Finds affected orders and sends approved delay notices only to controlled test inboxes." },
  { id: "storefront", name: "Storefront Agent", phase: "MVP", mode: "execution", tools: ["storefront.publish_banner"], description: "Publishes approved announcements visible on the working Nike demo store." },
] as const;
export const agentDisplayName = (id: string) => agentRoles.find(r => r.id === id)?.name || id;
