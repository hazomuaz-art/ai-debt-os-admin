"use client"

export default function TriggerBatchButton() {
  async function run() {
    await fetch("/api/orchestrator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "manual", batch: true }),
    })
    window.location.reload()
  }

  return (
    <button type="button" onClick={run} className="btn-primary text-xs px-3 py-2">
      Trigger Batch
    </button>
  )
}

