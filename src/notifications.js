import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { getAllExercises, getCurrentWeek, getGames } from './db/database';
import { addDays, startOfWeek, toDateKey, weekdayCode } from './utils/dates';
import { hasDay, hasWeek, shiftLetter } from './utils/weeks';

const CHANNEL_ID = 'treinos';
const REMINDER_TIMES = [
  { hour: 8, minute: 0 },
  { hour: 18, minute: 0 },
];
// 21 dias x 2 horários (+ os lembretes de jogo) cabem no limite de 64 agendamentos do iOS
const DAYS_AHEAD = 21;

// Mostra a notificação mesmo com o app aberto
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Lembretes de treino',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  if (!Device.isDevice) {
    console.log('Notificações só funcionam em dispositivo físico.');
    return false;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  // O sistema só exibe o diálogo na primeira vez; depois retorna o status salvo
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

function buildBody(names, letter) {
  if (names.length === 0) return `Semana ${letter}: hoje é dia de descanso. Aproveite pra recuperar! 🛌`;
  const list = names.slice(0, 4).join(', ');
  const extra = names.length > 4 ? ` e mais ${names.length - 4}` : '';
  return `Semana ${letter} (${names.length}): ${list}${extra}.`;
}

/**
 * Agenda os lembretes das 08:00 e 18:00 dos próximos 21 dias.
 * Como os exercícios mudam conforme a semana do ciclo (A, B, C...), cada lembrete
 * é agendado para uma data específica, com o texto daquele dia.
 * Junto vão os lembretes de avaliação dos jogos, no horário escolhido em cada jogo
 * (18:00 por padrão) — como o horário da partida varia, o lembrete é sempre no fim do dia.
 * É refeito toda vez que o app abre e quando exercícios, semanas ou jogos mudam.
 */
export async function scheduleDailyReminders() {
  await Notifications.cancelAllScheduledNotificationsAsync();

  const [exercises, current, games] = await Promise.all([
    getAllExercises(),
    getCurrentWeek(),
    getGames(),
  ]);
  const currentStart = startOfWeek();
  const now = new Date();

  for (let i = 0; i < DAYS_AHEAD; i++) {
    const day = addDays(now, i);
    const weeksAhead = Math.round((startOfWeek(day) - currentStart) / (7 * 24 * 60 * 60 * 1000));
    const letter = shiftLetter(current.letter, weeksAhead, current.count);
    const code = weekdayCode(day);
    const names = exercises
      .filter((e) => hasWeek(e, letter) && hasDay(e, code))
      .map((e) => e.name);

    for (const { hour, minute } of REMINDER_TIMES) {
      const date = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      if (date <= now) continue;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: hour < 12 ? '⚽ Bom dia! Hora do treino' : '⚽ Já treinou hoje?',
          body: buildBody(names, letter),
          sound: true,
          data: { type: 'training', date: toDateKey(day), week: letter },
        },
        trigger: { date, channelId: CHANNEL_ID },
      });
    }

    // Lembretes de avaliação dos jogos do dia
    for (const game of games.filter((g) => g.day === code)) {
      const date = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        game.reminder_hour,
        game.reminder_minute
      );
      if (date <= now) continue;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🏆 Teve jogo hoje?',
          body: `Avalie seu desempenho: ${game.name}.`,
          sound: true,
          data: { type: 'game', gameId: game.id, date: toDateKey(day) },
        },
        trigger: { date, channelId: CHANNEL_ID },
      });
    }
  }
}
