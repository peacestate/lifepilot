/**
 * EnergyCurve — the calm energy forecast line (design spec §1, primary visualization).
 * One smooth sage curve across the day. No gridlines, no y-axis numbers (energy is a
 * relative shape, not a clinical metric). Peak and dip marked with a dot + word label.
 * A few hour ticks for orientation. Uses react-native-svg.
 *
 * a11y: decorative; the screen supplies a text summary so visual + screen-reader agree.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { color, type } from '../theme/tokens';

type Props = {
  points: number[];                 // 24 values, 0..100
  peakHour: number;
  dipHour: number;
  width?: number;
  height?: number;
  dashed?: boolean;                 // cold-start "ghost" curve
};

const hourLabel = (h: number) => {
  const x = h % 12 === 0 ? 12 : h % 12;
  return `${x}${h < 12 ? 'a' : 'p'}`;
};

export function EnergyCurve({ points, peakHour, dipHour, width = 320, height = 180, dashed }: Props) {
  const padX = 12;
  const padY = 18;
  const w = width - padX * 2;
  const h = height - padY * 2;
  const x = (hour: number) => padX + (hour / 23) * w;
  const y = (val: number) => padY + (1 - val / 100) * h;

  // smooth path via midpoint quadratic segments
  let d = `M ${x(0)} ${y(points[0])}`;
  for (let i = 1; i < points.length; i++) {
    const xm = (x(i - 1) + x(i)) / 2;
    const ym = (y(points[i - 1]) + y(points[i])) / 2;
    d += ` Q ${x(i - 1)} ${y(points[i - 1])} ${xm} ${ym}`;
  }
  d += ` T ${x(23)} ${y(points[23])}`;

  const ticks = [7, 12, 17, 21];

  return (
    <View>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color.accent} stopOpacity="0.18" />
            <Stop offset="1" stopColor={color.accent} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        {/* soft area under the curve */}
        <Path d={`${d} L ${x(23)} ${height - padY} L ${x(0)} ${height - padY} Z`} fill="url(#eg)" />
        {/* the curve */}
        <Path
          d={d}
          stroke={color.accent}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={dashed ? '5 7' : undefined}
          opacity={dashed ? 0.5 : 1}
        />
        {!dashed && (
          <>
            <Circle cx={x(peakHour)} cy={y(points[peakHour])} r={5} fill={color.accent} />
            <Circle cx={x(dipHour)} cy={y(points[dipHour])} r={4} fill={color.textTertiary} />
          </>
        )}
      </Svg>
      <View style={[styles.ticks, { width, paddingHorizontal: padX }]}>
        {ticks.map((t) => (
          <Text key={t} style={[styles.tick, { position: 'absolute', left: x(t) - 10 }]}>{hourLabel(t)}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ticks: { height: 16, marginTop: -6 },
  tick: { ...type.caption, color: color.textTertiary },
});

export default EnergyCurve;
