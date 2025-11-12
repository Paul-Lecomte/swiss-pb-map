"use client";
import React from "react";

export default function StreamProgress({ total, received, elapsedMs, loading }: { total?: number; received: number; elapsedMs?: number; loading: boolean }) {
  const pct = total && total > 0 ? Math.min(100, Math.round((received / total) * 100)) : undefined;
  return (
    <div style={{
      position: 'absolute',
      top: 16,
      right: 16,
      zIndex: 1100,
      background: 'rgba(0,0,0,0.6)',
      color: '#fff',
      padding: '6px 10px',
      borderRadius: 8,
      fontSize: 12,
      minWidth: 140,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      pointerEvents: 'none'
    }}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <span>Routes</span>
        <span>{received}{total ? ` / ${total}` : ""}</span>
      </div>
      {pct != null && (
        <div style={{height: 6, background: 'rgba(255,255,255,0.2)', borderRadius: 4}}>
          <div style={{height: '100%', width: `${pct}%`, background: '#4caf50', borderRadius: 4}} />
        </div>
      )}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <span>Status</span>
        <span>{loading ? 'Streaming…' : 'Done'}</span>
      </div>
      {elapsedMs != null && !loading && (
        <div style={{opacity: 0.8}}>~{Math.round(elapsedMs)} ms</div>
      )}
    </div>
  );
}

