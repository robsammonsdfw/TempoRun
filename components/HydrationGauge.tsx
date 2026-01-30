
import React from 'react';

interface HydrationGaugeProps {
  fluidLost: number;
  fluidIntake: number;
  onHydrate: () => void;
}

export const HydrationGauge: React.FC<HydrationGaugeProps> = ({ fluidLost, fluidIntake, onHydrate }) => {
  // We assume a "buffer" of 500ml before the body starts feeling dehydrated effects effectively
  // This gauge visualizes the net balance.
  // 0 means balanced. Negative means deficit.
  const netFluid = fluidIntake - fluidLost;
  
  // Visual range: -1000ml (Empty) to +200ml (Full)
  const minLimit = -1000;
  const maxLimit = 200;
  
  const percentage = Math.max(0, Math.min(100, ((netFluid - minLimit) / (maxLimit - minLimit)) * 100));
  
  const isLow = netFluid < -500; // Warning level

  return (
    <div className="bg-zinc-900/50 p-2 rounded-3xl border border-white/5 flex flex-col items-center justify-center relative overflow-hidden h-full">
      <div className="text-[10px] font-black text-cyan-500 uppercase mb-1 flex items-center gap-1">
        Coolant {isLow && <span className="animate-ping w-1.5 h-1.5 rounded-full bg-cyan-500"></span>}
      </div>
      
      <div className="relative w-10 h-24 bg-zinc-800 rounded-full overflow-hidden border border-zinc-700">
        {/* Liquid */}
        <div 
          className={`absolute bottom-0 left-0 right-0 transition-all duration-1000 ${isLow ? 'bg-cyan-600' : 'bg-cyan-400'}`}
          style={{ height: `${percentage}%` }}
        >
          {/* Bubbles animation */}
          <div className="absolute w-full h-full opacity-30 animate-pulse bg-white/10"></div>
        </div>
        
        {/* Markers */}
        <div className="absolute top-1/4 left-0 right-0 h-px bg-black/20"></div>
        <div className="absolute top-2/4 left-0 right-0 h-px bg-black/20"></div>
        <div className="absolute top-3/4 left-0 right-0 h-px bg-black/20"></div>
      </div>

      <div className="text-center mt-1">
        <div className="text-xl font-black italic leading-none text-white">
           {Math.abs(Math.round(netFluid))}
        </div>
        <div className="text-[8px] text-zinc-500 font-bold uppercase">mL {netFluid < 0 ? 'Deficit' : 'Surplus'}</div>
      </div>

      {/* Hydrate Button (Tap to add 150ml - typical gulp) */}
      <button 
        onClick={onHydrate}
        className="mt-2 w-full py-2 bg-cyan-900/50 hover:bg-cyan-800 border border-cyan-500/30 rounded-xl text-[10px] font-black uppercase text-cyan-300 transition-all active:scale-95"
      >
        + Sip
      </button>
    </div>
  );
};
