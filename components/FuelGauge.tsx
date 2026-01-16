
import React from 'react';

interface FuelGaugeProps {
  startCalories: number;
  burnedCalories: number;
}

export const FuelGauge: React.FC<FuelGaugeProps> = ({ startCalories, burnedCalories }) => {
  const remaining = startCalories - burnedCalories;
  
  // Calculate Percentage (0 to 100)
  // If startCalories is 0 (didn't eat), we assume a reserve "Tank" of 1200 calories (glycogen stores)
  const maxCapacity = startCalories > 0 ? startCalories : 1200; 
  const currentVal = startCalories > 0 ? remaining : (1200 - burnedCalories);
  
  const percentage = Math.max(0, Math.min(100, (currentVal / maxCapacity) * 100));
  
  // Rotation Logic:
  // -90deg is Empty (Left), 90deg is Full (Right)
  // Mapping 0% -> -90, 100% -> 90
  const rotation = (percentage / 100) * 180 - 90;

  const isLowFuel = percentage < 20;

  return (
    <div className="bg-zinc-900/50 p-2 rounded-3xl border border-white/5 flex flex-col items-center justify-center relative overflow-hidden">
      <div className="text-[10px] font-black text-zinc-500 uppercase mb-1">Fuel Gauge</div>
      
      {/* Gauge Container */}
      <div className="relative w-24 h-14 mt-1">
        {/* SVG Gauge */}
        <svg viewBox="0 0 100 60" className="w-full h-full overflow-visible">
          {/* Background Arc */}
          <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#334155" strokeWidth="12" strokeLinecap="round" />
          
          {/* Colored Segments (Gradient Simulation) */}
          {/* Low (Red) */}
          <path d="M 10 50 A 40 40 0 0 1 30 15.3" fill="none" stroke="#ef4444" strokeWidth="12" strokeLinecap="round" opacity="0.3" />
          
          {/* Ticks */}
          <text x="5" y="55" fontSize="10" fontWeight="900" fill="#ef4444">E</text>
          <text x="85" y="55" fontSize="10" fontWeight="900" fill="#10b981">F</text>

          {/* Needle */}
          <g transform={`rotate(${rotation}, 50, 50)`}>
             <line x1="50" y1="50" x2="50" y2="10" stroke={isLowFuel ? "#ef4444" : "#facc15"} strokeWidth="3" strokeLinecap="round" />
             <circle cx="50" cy="50" r="4" fill="#1e293b" stroke="white" strokeWidth="2" />
          </g>
        </svg>
      </div>

      <div className="text-center mt-1 z-10">
        <div className={`text-xl font-black italic leading-none ${isLowFuel ? 'text-red-500 animate-pulse' : 'text-white'}`}>
           {Math.max(0, Math.round(currentVal))} 
        </div>
        <div className="text-[8px] text-zinc-600 font-bold uppercase">Kcal Left</div>
      </div>

      {isLowFuel && (
        <div className="absolute top-1 right-2 w-2 h-2 rounded-full bg-red-500 animate-ping"></div>
      )}
      
      {isLowFuel && (
         <div className="absolute inset-0 bg-red-500/10 z-0 animate-pulse rounded-3xl pointer-events-none"></div>
      )}
    </div>
  );
};
