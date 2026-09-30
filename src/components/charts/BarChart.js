import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '../../theme';
import { linear, nearestIndex } from './scale';

const PAD = { top: 10, right: 6, bottom: 22, left: 40 };
const GAP = 2; // espaço entre barras
const MAX_BAR = 26;
const RADIUS = 4;

// Barra com cantos arredondados só em cima, ancorada na base
function barPath(x, yTop, w, yBase) {
  const h = yBase - yTop;
  if (h <= 0) return '';
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${yBase} L${x},${yTop + r} Q${x},${yTop} ${x + r},${yTop} L${x + w - r},${yTop} Q${x + w},${yTop} ${x + w},${yTop + r} L${x + w},${yBase} Z`;
}

/**
 * Barras de uma série só. Por padrão em porcentagem (0–100).
 * bars: [{ label, value, caption, partial }] — "partial" (período em andamento) fica mais claro.
 * Para outras escalas: max (topo do eixo), formatTick, formatValue e valueUnit.
 * reference: { value, label } desenha uma linha tracejada de referência (ex.: TMB).
 * targets: um valor por barra (ou null), desenhado como um traço escuro sobre ela (ex.: gasto do dia).
 */
export default function BarChart({
  bars,
  height = 170,
  max = 100,
  formatTick = (t) => `${t}%`,
  formatValue = (v) => `${Math.round(v)}%`,
  valueUnit = 'concluído',
  reference,
  targets,
}) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState(bars.length - 1);

  useEffect(() => setSelected(bars.length - 1), [bars.length]);

  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(bars.length, 1);
  const barW = Math.max(Math.min(slot - GAP, MAX_BAR), 2);
  const y = linear(0, max, PAD.top + plotH, PAD.top);
  const ticks = [0, max / 2, max];
  const centers = bars.map((_, i) => PAD.left + slot * i + slot / 2);
  // com muitas barras, rotula só algumas (a selecionada sempre aparece)
  const labelEvery = Math.ceil(bars.length / 14);

  const sel = bars[Math.min(selected, bars.length - 1)];
  const selIdx = bars.indexOf(sel);

  const onTouch = (e) => {
    if (bars.length > 0) setSelected(nearestIndex(centers, e.nativeEvent.locationX));
  };

  return (
    <View>
      {sel && (
        <View style={styles.readout}>
          <Text style={styles.readoutValue}>
            {formatValue(sel.value)} <Text style={styles.readoutUnit}>{valueUnit}</Text>
          </Text>
          <Text style={styles.readoutCaption}>{sel.caption}</Text>
        </View>
      )}

      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg width={width} height={height}>
            {ticks.map((t) => (
              <Line key={`g${t}`} x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? colors.border : colors.grid} strokeWidth={1} />
            ))}
            {ticks.map((t) => (
              <SvgText key={`t${t}`} x={PAD.left - 6} y={y(t) + 4} fontSize={11} fill={colors.muted} textAnchor="end">
                {formatTick(t)}
              </SvgText>
            ))}

            {bars.map((b, i) => {
              const left = centers[i] - barW / 2;
              return (
                <Path
                  key={i}
                  d={barPath(left, y(Math.max(b.value, 0)), barW, y(0))}
                  fill={colors.primary}
                  opacity={b.partial ? 0.45 : 1}
                />
              );
            })}

            {/* meta por barra: traço escuro com contorno claro, visível sobre a barra ou fora dela */}
            {targets?.map((t, i) =>
              t == null || t > max ? null : (
                <Line
                  key={`t${i}`}
                  x1={centers[i] - barW / 2 - 3}
                  x2={centers[i] + barW / 2 + 3}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={colors.card}
                  strokeWidth={5}
                  strokeLinecap="round"
                />
              )
            )}
            {targets?.map((t, i) =>
              t == null || t > max ? null : (
                <Line
                  key={`T${i}`}
                  x1={centers[i] - barW / 2 - 2}
                  x2={centers[i] + barW / 2 + 2}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={colors.text}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
              )
            )}

            {/* linha de referência; o rótulo fica à esquerda, com fundo, para não sumir atrás das barras */}
            {reference && reference.value <= max && (
              <>
                <Line
                  x1={PAD.left}
                  x2={PAD.left + plotW}
                  y1={y(reference.value)}
                  y2={y(reference.value)}
                  stroke={colors.text}
                  strokeWidth={1.5}
                  strokeDasharray="5,4"
                />
                <Rect
                  x={PAD.left + 2}
                  y={y(reference.value) - 17}
                  width={reference.label.length * 6.4 + 8}
                  height={15}
                  rx={3}
                  fill={colors.card}
                  opacity={0.9}
                />
                <SvgText x={PAD.left + 6} y={y(reference.value) - 6} fontSize={11} fill={colors.text}>
                  {reference.label}
                </SvgText>
              </>
            )}

            {/* marca a barra selecionada com um traço abaixo dela */}
            {sel && (
              <Rect x={centers[selIdx] - barW / 2} y={y(0) + 2} width={barW} height={2} rx={1} fill={colors.text} />
            )}

            {bars.map((b, i) =>
              i % labelEvery !== 0 && i !== selIdx ? null : (
              <SvgText
                key={`l${i}`}
                x={centers[i]}
                y={height - 5}
                fontSize={11}
                fontWeight={i === selIdx ? '700' : '400'}
                fill={i === selIdx ? colors.text : colors.muted}
                textAnchor="middle"
              >
                {b.label}
              </SvgText>
              )
            )}
          </Svg>
        )}

        <View
          style={StyleSheet.absoluteFill}
          onStartShouldSetResponder={() => true}
          onResponderGrant={onTouch}
          onResponderMove={onTouch}
          onResponderTerminationRequest={() => true}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 },
  readoutValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  readoutUnit: { fontSize: 13, fontWeight: '500', color: colors.muted },
  readoutCaption: { fontSize: 12, color: colors.muted, flexShrink: 1, textAlign: 'right', marginLeft: 8 },
});
