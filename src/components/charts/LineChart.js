import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { colors } from '../../theme';
import { formatNumber } from '../../utils/health';
import { linear, nearestIndex, niceDomain } from './scale';

const PAD = { top: 10, right: 14, bottom: 22, left: 40 };

/**
 * Gráfico de linha de uma série só (o título do card nomeia a série).
 * points: [{ date: Date, value: number, caption: string }] em ordem cronológica.
 * Tocar/arrastar sobre o gráfico seleciona o ponto mais próximo e mostra o valor.
 */
export default function LineChart({
  points,
  unit,
  decimals = 1,
  height = 180,
  goal,
  goalLabel,
  minSpan = 2,
  formatDate,
}) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState(points.length - 1);

  // novo ponto registrado -> seleciona o mais recente
  useEffect(() => setSelected(points.length - 1), [points.length]);

  const values = points.map((p) => p.value);
  const domain = niceDomain(goal != null ? [...values, goal] : values, { minSpan });
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = height - PAD.top - PAD.bottom;

  const times = points.map((p) => p.date.getTime());
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const x = tMax === tMin
    ? () => PAD.left + plotW / 2
    : linear(tMin, tMax, PAD.left, PAD.left + plotW);
  const y = linear(domain.min, domain.max, PAD.top + plotH, PAD.top);

  const xs = points.map((p) => x(p.date.getTime()));
  const ys = points.map((p) => y(p.value));
  const path = xs.map((px, i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');

  const sel = points[Math.min(selected, points.length - 1)];
  const selIdx = points.indexOf(sel);

  const onTouch = (e) => {
    if (points.length > 0) setSelected(nearestIndex(xs, e.nativeEvent.locationX));
  };

  return (
    <View>
      {sel && (
        <View style={styles.readout}>
          <Text style={styles.readoutValue}>
            {formatNumber(sel.value, decimals)} <Text style={styles.readoutUnit}>{unit}</Text>
          </Text>
          <Text style={styles.readoutCaption}>{sel.caption}</Text>
        </View>
      )}

      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg width={width} height={height}>
            {/* grade e eixo Y (recessivos) */}
            {domain.ticks.map((t) => (
              <Line key={`g${t}`} x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={colors.grid} strokeWidth={1} />
            ))}
            {domain.ticks.map((t) => (
              <SvgText key={`t${t}`} x={PAD.left - 6} y={y(t) + 4} fontSize={11} fill={colors.muted} textAnchor="end">
                {formatNumber(t, Number.isInteger(t) ? 0 : 1)}
              </SvgText>
            ))}

            {/* meta */}
            {goal != null && (
              <>
                <Line x1={PAD.left} x2={PAD.left + plotW} y1={y(goal)} y2={y(goal)} stroke={colors.muted} strokeWidth={1.5} strokeDasharray="5,4" />
                <SvgText x={PAD.left + plotW} y={y(goal) - 5} fontSize={11} fill={colors.muted} textAnchor="end">
                  {goalLabel}
                </SvgText>
              </>
            )}

            {/* linha guia do ponto selecionado */}
            {sel && (
              <Line x1={xs[selIdx]} x2={xs[selIdx]} y1={PAD.top} y2={PAD.top + plotH} stroke={colors.border} strokeWidth={1} />
            )}

            {points.length > 1 && (
              <Path d={path} stroke={colors.primary} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            )}

            {/* pontos com anel da cor da superfície */}
            {points.map((p, i) => (
              <Circle
                key={i}
                cx={xs[i]}
                cy={ys[i]}
                r={i === selIdx ? 6 : 4}
                fill={colors.primary}
                stroke={colors.card}
                strokeWidth={2}
              />
            ))}

            {/* datas: primeira e última */}
            {points.length > 0 && (
              <SvgText x={xs[0]} y={height - 6} fontSize={11} fill={colors.muted} textAnchor={points.length > 1 ? 'start' : 'middle'}>
                {formatDate(points[0].date)}
              </SvgText>
            )}
            {points.length > 1 && (
              <SvgText x={xs[xs.length - 1]} y={height - 6} fontSize={11} fill={colors.muted} textAnchor="end">
                {formatDate(points[points.length - 1].date)}
              </SvgText>
            )}
          </Svg>
        )}

        {/* camada de toque maior que as marcas */}
        <View
          style={StyleSheet.absoluteFill}
          onStartShouldSetResponder={() => true}
          onResponderGrant={onTouch}
          onResponderMove={onTouch}
          onResponderTerminationRequest={() => true}
        />
      </View>

      {points.length === 1 && (
        <Text style={styles.hint}>A linha aparece a partir da segunda medição.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 },
  readoutValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  readoutUnit: { fontSize: 13, fontWeight: '500', color: colors.muted },
  readoutCaption: { fontSize: 12, color: colors.muted },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 4 },
});
