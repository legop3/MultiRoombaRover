// Discord Fleet Daily Reports
// Purpose: Schedules and delivers completed-day fleet summaries to the existing admin alert channel.
// Scope: Discord owns timing/formatting/delivery; the fleet service owns evidence, analysis, and durable delivery state.
const { DateTime } = require('luxon');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

function parseSendTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return { hour: 8, minute: 0 };
  return {
    hour: Math.max(0, Math.min(23, Number(match[1]))),
    minute: Math.max(0, Math.min(59, Number(match[2]))),
  };
}

function nextRunAt({ zone, hour, minute }) {
  const now = DateTime.now().setZone(zone);
  let next = now.set({ hour, minute, second: 0, millisecond: 0 });
  if (next <= now) next = next.plus({ days: 1 });
  return next;
}

function formatNumber(value, digits = 1) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function createFleetDailyReports({ logger, discordConfig, fleetConfig, fleetReportService, roverManager, sendToChannel }) {
  let timer = null;
  const reportConfig = fleetConfig?.discord || {};
  const enabled = fleetReportService?.enabled && reportConfig.enabled !== false;
  const channelId = discordConfig?.channels?.adminAlerts;
  const zone = String(reportConfig.timezone || 'America/New_York');
  const { hour, minute } = parseSendTime(reportConfig.sendAt);

  function publicRoverIds() {
    // Discord's shared admin-alert channel does not provide a per-viewer socket
    // against which private-rover grants can be checked. Excluding private
    // rovers here preserves the existing privacy boundary instead of assuming
    // every channel reader has every private grant.
    return roverManager.getRoster()
      .filter((rover) => !rover?.private?.enabled)
      .map((rover) => String(rover.id));
  }

  function completedDayRange() {
    const end = DateTime.now().setZone(zone).startOf('day');
    const start = end.minus({ days: 1 });
    return {
      reportDate: start.toISODate(),
      since: start.toMillis(),
      until: end.toMillis(),
    };
  }

  function buildEmbed(reportDate, report) {
    const totals = report.totals;
    const attention = report.findings.slice(0, 12).map((finding) =>
      `• ${finding.roverId ? `${finding.roverId}: ` : ''}${finding.title} (${finding.severity}, ${finding.confidence} confidence)`,
    ).join('\n') || 'No report findings.';
    const roverLines = report.rovers.map((rover) =>
      `• ${rover.name}: ${formatNumber(rover.dischargedMah)} mAh used, ${formatNumber(rover.chargedMah)} mAh charged, ${formatNumber(rover.sampleCount, 0)} samples, ${formatNumber(rover.gapCount, 0)} gaps`,
    ).join('\n') || 'No public rover telemetry.';
    return new EmbedBuilder()
      .setTitle(`Daily fleet report — ${reportDate}`)
      .setColor(totals.criticalFindingCount ? 0xe53935 : totals.warningFindingCount ? 0xf0b651 : 0x4caf50)
      .addFields(
        {
          name: 'Fleet totals',
          value: `${totals.onlineRoverCount}/${totals.roverCount} online · ${formatNumber(totals.sampleCount, 0)} samples · ${formatNumber(totals.dischargedMah)} mAh used · ${formatNumber(totals.chargedMah)} mAh charged · ${formatNumber(totals.telemetryGapCount, 0)} gaps`,
        },
        { name: 'Needs attention', value: attention.slice(0, 1024) },
        { name: 'Rovers', value: roverLines.slice(0, 1024) },
      )
      .setFooter({ text: 'Detailed read-only evidence is available on the server reports page.' });
  }

  async function deliverPreviousDay() {
    if (!enabled || !channelId) return;
    const range = completedDayRange();
    const existing = fleetReportService.storage.getDailyReport(range.reportDate);
    if (existing?.discordDeliveredAt) return;
    const report = existing?.report || fleetReportService.getDailyReport({
      since: range.since,
      until: range.until,
      roverIds: publicRoverIds(),
    });
    if (!report) return;
    // Lockdown-only records and raw event payloads do not belong in a shared
    // Discord attachment. The interactive server UI applies per-socket access
    // and remains the place for complete event evidence.
    const attachmentReport = {
      ...report,
      events: report.events.filter((event) => event.visibility !== 'lockdown').map(({ payload, ...event }) => ({
        ...event,
        payload,
      })),
    };
    fleetReportService.storage.saveDailyReport(range.reportDate, attachmentReport);
    const attachment = new AttachmentBuilder(
      Buffer.from(JSON.stringify(attachmentReport, null, 2)),
      { name: `fleet-report-${range.reportDate}.json` },
    );
    const sent = await sendToChannel(
      channelId,
      `Daily fleet report for ${range.reportDate}`,
      { embeds: [buildEmbed(range.reportDate, report)], files: [attachment] },
      { parse: [] },
    );
    if (sent) {
      fleetReportService.storage.markDailyReportDelivery(range.reportDate, { deliveredAt: Date.now(), error: null });
    } else {
      fleetReportService.storage.markDailyReportDelivery(range.reportDate, { error: 'Discord delivery returned no message' });
    }
  }

  function scheduleNext() {
    if (!enabled || !channelId) return;
    const next = nextRunAt({ zone, hour, minute });
    const delay = Math.max(1000, next.toMillis() - Date.now());
    timer = setTimeout(async () => {
      try {
        await deliverPreviousDay();
      } catch (err) {
        logger.warn('Daily fleet report delivery failed', { error: err.message });
      } finally {
        scheduleNext();
      }
    }, delay);
    timer.unref?.();
    logger.info('Scheduled daily fleet report', { nextRunAt: next.toISO(), channelId });
  }

  function start() {
    scheduleNext();
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { start, stop, deliverPreviousDay };
}

module.exports = {
  createFleetDailyReports,
};
