import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Split } from '../types';

interface SplitsChartProps {
  splits: Split[];
}

export const SplitsChart: React.FC<SplitsChartProps> = ({ splits }) => {
  if (splits.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center bg-slate-800/50 rounded-xl border border-slate-700 text-slate-500 text-sm">
        Start running to see splits data
      </div>
    );
  }

  // Transform data for easy charting. Convert pace string "8:30" back to approximate seconds for Y-axis
  const data = splits.map(s => {
    const [min, sec] = s.pace.split(':').map(Number);
    const totalSeconds = (min * 60) + (sec || 0);
    return {
      name: s.distanceLabel,
      paceSeconds: totalSeconds,
      paceLabel: s.pace
    };
  });

  const formatYAxis = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="h-64 w-full bg-slate-800/50 p-4 rounded-xl border border-slate-700">
      <h3 className="text-slate-300 font-semibold mb-4 text-sm uppercase tracking-wider">Splits Pace Trend</h3>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorPace" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis 
            dataKey="name" 
            stroke="#94a3b8" 
            fontSize={12} 
            tickLine={false}
            axisLine={false}
          />
          <YAxis 
            stroke="#94a3b8" 
            fontSize={12} 
            tickFormatter={formatYAxis} 
            domain={['dataMin - 30', 'dataMax + 30']}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px', color: '#f1f5f9' }}
            itemStyle={{ color: '#10b981' }}
            formatter={(value: number) => [formatYAxis(value), 'Pace']}
            labelStyle={{ color: '#94a3b8', marginBottom: '0.25rem' }}
          />
          <Area 
            type="monotone" 
            dataKey="paceSeconds" 
            stroke="#10b981" 
            strokeWidth={3}
            fillOpacity={1} 
            fill="url(#colorPace)" 
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};