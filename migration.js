(() => {
  'use strict';
  const sourceOrigin = 'https://app-0mb189.v2.appdeploy.ai';
  const storageKey = 'chibari_independent_v1';
  const clean = value => String(value ?? '');
  const phoneKey = value => clean(value).replace(/\D/g, '');
  function importLegacy(payload) {
    if (payload?.format !== 'chibari_legacy_migration_v1' || !Array.isArray(payload.days) || !Array.isArray(payload.contacts) || !Array.isArray(payload.addresses)) throw Error('移行ファイルの形式が違います');
    if (payload.days.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Array.isArray(day.stops))) throw Error('日別記録の形式が違います');
    const previous = localStorage.getItem(storageKey);
    const next = previous ? JSON.parse(previous) : {};
    for (const key of ['schedule', 'contacts', 'addresses', 'reports']) if (!Array.isArray(next[key])) next[key] = [];
    localStorage.setItem('chibari_before_legacy_migration', previous || '{}');
    const archiveKey = 'chibari_legacy_archive_' + Date.now();
    const archive = JSON.stringify(payload);
    localStorage.setItem(archiveKey, archive);
    if (localStorage.getItem(archiveKey) !== archive) throw Error('原記録を保存できませんでした');
    const add = (type, value, match) => {
      if (!next[type].some(match)) next[type].push(value);
    };
    const addContact = (company, contact, phone, note = '') => {
      const number = phoneKey(phone);
      if (!number) return;
      add('contacts', {id: 'legacy-phone-' + number, name: [company, contact].filter(Boolean).join(' ／ '), phone: clean(phone), note}, item => phoneKey(item.phone) === number);
    };
    for (const entry of payload.contacts) addContact(entry.company || entry.name, entry.contact, entry.phone);
    for (const entry of payload.addresses) {
      const value = {id: 'legacy-address-' + entry.id, name: clean(entry.name), address: clean(entry.address), phone: clean(entry.phone), note: [entry.kana, entry.contact, entry.note].filter(Boolean).join(' ／ '), legacy: entry};
      add('addresses', value, item => item.name === value.name && item.address === value.address);
      addContact(entry.name, entry.contact, entry.phone);
    }
    for (const day of payload.days) {
      for (const [index, stop] of day.stops.entries()) {
        const id = 'legacy-stop-' + day.date + '-' + (stop.id ?? index);
        const value = {id, date: day.date, time: clean(stop.time), place: [stop.company, stop.site].filter(Boolean).join(' ／ '), address: clean(stop.address), person: clean(stop.contact), phone: clean(stop.phone), status: stop.depart ? '完了' : stop.arrive ? '配送中' : '未着手', note: [stop.note, stop.contact2 ? '担当者2：' + stop.contact2 : '', stop.phone2 ? '電話2：' + stop.phone2 : '', stop.arrive ? '到着：' + stop.arrive : '', stop.unload ? '荷下ろし：' + stop.unload : '', stop.depart ? '出発：' + stop.depart : '', stop.carryBack ? '持戻り：' + stop.carryBack : ''].filter(Boolean).join(' ／ '), legacy: stop};
        add('schedule', value, item => item.id === id);
        if (stop.address) add('addresses', {id: 'legacy-site-' + id, name: value.place, address: value.address, phone: value.phone, note: [stop.contact, stop.note].filter(Boolean).join(' ／ '), legacy: stop}, item => item.name === value.place && item.address === value.address);
        addContact(stop.company, stop.contact, stop.phone);
        addContact(stop.company, stop.contact2, stop.phone2);
      }
      const minutes = value => {const match = clean(value).match(/^(\d{1,2}):(\d{2})$/); return match ? Number(match[1]) * 60 + Number(match[2]) : null;};
      const start = minutes(day.breakStart), end = minutes(day.breakEnd);
      const breaks = start !== null && end !== null ? (end - start + 1440) % 1440 : '';
      const toll = Array.isArray(day.highwayEntries) && day.highwayEntries.length ? day.highwayEntries.reduce((total, item) => total + (Number(item.cost) || 0), 0) : day.highwayCost || '';
      const hasActual = day.started || day.finished || day.startMeter || day.endMeter || day.fuelLiters || day.fuelAmount || toll || day.stops.some(stop => stop.arrive || stop.unload || stop.depart || stop.carryBack);
      if (hasActual) {
        const id = 'legacy-report-' + day.date;
        add('reports', {id, date: day.date, driver: clean(day.driver), start: clean(day.started), end: clean(day.finished), meterStart: clean(day.startMeter), meterEnd: clean(day.endMeter), breakMinutes: clean(breaks), deliveryCount: clean(day.stops.filter(stop => stop.arrive).length), toll: clean(toll), fuelLiters: clean(day.fuelLiters), fuelYen: clean(day.fuelAmount), note: '旧アプリから移行。現場別時刻は配送予定に保持。車両：' + clean(day.vehicle) + ' ／ 出発地：' + clean(day.startLocation), legacy: day}, item => item.id === id);
      }
    }
    next.legacyArchives = [...(next.legacyArchives || []), {key: archiveKey, exportedAt: payload.exportedAt}];
    next.legacyRaw = payload;
    const serialized = JSON.stringify(next);
    localStorage.setItem(storageKey, serialized);
    if (localStorage.getItem(storageKey) !== serialized) throw Error('移行後の保存確認に失敗しました');
    return {schedule: next.schedule.length, addresses: next.addresses.length, contacts: next.contacts.length, reports: next.reports.length};
  }
  function finish(payload) {
    const counts = importLegacy(payload);
    sessionStorage.setItem('chibari_migration_result', JSON.stringify(counts));
    return counts;
  }
  const migrationBox = document.createElement('section');
  migrationBox.className = 'panel';
  migrationBox.innerHTML = '<h2>旧アプリの記録を取り込む</h2><p>自動で移らなかった場合は、旧アプリからダウンロードされた「chibari-full-migration.json」を選んでください。今ある記録に追加し、同じ移行記録は重複させません。</p><label>移行ファイルを選択<input type="file" accept=".json,application/json" id="legacyMigrationFile"></label><p id="legacyMigrationStatus" role="status"></p>';
  document.querySelector('.wrap').prepend(migrationBox);
  const migrationFile = document.getElementById('legacyMigrationFile');
  migrationFile.onchange = async () => {
    const status = document.getElementById('legacyMigrationStatus');
    try {
      const file = migrationFile.files[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) throw Error('20MB以下のファイルを選んでください');
      finish(JSON.parse(await file.text()));
      location.reload();
    } catch (error) { status.textContent = '取り込みできませんでした：' + error.message; }
  };
  const observer = new MutationObserver(() => {
    const input = document.getElementById('import');
    if (!input || input.dataset.legacyReady) return;
    input.dataset.legacyReady = '1';
    const original = input.onchange;
    input.onchange = async event => {
      try {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) throw Error('20MB以下のファイルを選んでください');
        const payload = JSON.parse(await file.text());
        if (payload.format !== 'chibari_legacy_migration_v1') return original.call(input, event);
        finish(payload);
        location.reload();
      } catch (error) { alert('移行できませんでした：' + error.message); }
    };
  });
  observer.observe(document.getElementById('panel'), {childList:true, subtree:true});
  const result = sessionStorage.getItem('chibari_migration_result');
  if (result) {
    const counts = JSON.parse(result);
    const notice = document.createElement('div');
    notice.className = 'notice';
    notice.textContent = `移行完了：住所${counts.addresses}件／連絡先${counts.contacts}件／配送予定${counts.schedule}件／日報${counts.reports}件。現場別の時刻と元データも保存しました。過去の予定は「全日付を表示」で確認できます。バックアップを書き出してください。`;
    document.querySelector('.wrap').prepend(notice);
    sessionStorage.removeItem('chibari_migration_result');
  }
  const nonce = new URLSearchParams(location.hash.slice(1)).get('migration');
  if (!nonce || !window.opener) return;
  const opener = window.opener;
  let busy = false;
  const timer = setInterval(() => opener.postMessage({type:'chibari-ready',nonce}, sourceOrigin), 500);
  setTimeout(() => clearInterval(timer), 300000);
  window.addEventListener('message', event => {
    if (busy || event.origin !== sourceOrigin || event.source !== opener || event.data?.nonce !== nonce || event.data.type !== 'chibari-transfer') return;
    busy = true;
    clearInterval(timer);
    try {
      const counts = finish(event.data.payload);
      opener.postMessage({type:'chibari-complete',nonce,counts}, sourceOrigin);
      location.replace(location.pathname);
    } catch (error) { alert('移行できませんでした：' + error.message + '。旧アプリの記録とダウンロードしたJSONは残っています。'); }
  });
})();
