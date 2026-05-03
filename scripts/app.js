(() => {
  'use strict';

  /* -------------------- Yardımcılar -------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const show  = el => el && (el.hidden = false);
  const hide  = el => el && (el.hidden = true);

  const scrollToEl = el => {
    if (!el) return;
    const offset = 12 * window.innerHeight / 100;
    const y = el.getBoundingClientRect().top + window.pageYOffset - offset;
    setTimeout(() => window.scrollTo({ top: y, behavior: 'smooth' }), 20);
  };

  async function fetchJSON(url) {
    const bust = (url.includes('?') ? '&' : '?') + 'v=' + Date.now();
    const finalUrl = url + bust;
    console.debug('[fetchJSON] GET', finalUrl);
    const res = await fetch(finalUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`[fetchJSON] HTTP ${res.status} for ${url}`);
    return await res.json();
  }

  function slugifyTitle(title) {
    return String(title || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
      .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  /* -------------------- SlidePlayer ders haritası -------------------- */

  // "airplane-general/general" -> "egitim1/airplane-general/general"
  const slideLessonMap = Object.create(null);

  async function loadSlideLessonConfig() {
    try {
      // kök /index.html’den bakınca doğru path
      const cfg = await fetchJSON('learjet-slideplayer-demo/lessons.json');
      Object.keys(cfg || {}).forEach(groupKey => {
        const group = cfg[groupKey] || {};
        const base = group.id || groupKey; // örn: "airplane-general"
        (group.lessons || []).forEach(ls => {
          const lid = ls.id || slugifyTitle(ls.title || '');
          const key = `${base}/${lid}`;    // örn: "airplane-general/general"
          if (ls.pkg) {
            slideLessonMap[key] = ls.pkg;
          }
        });
      });
      console.debug('[SlideLessons] map yüklendi:', slideLessonMap);
    } catch (e) {
      console.warn('[SlideLessons] lessons.json yüklenemedi', e);
    }
  }

  function openSlidePlayerWithPkg(pkg) {
    if (!pkg) return;
    const url = `learjet-slideplayer-demo/slide-player.html?pkg=${encodeURIComponent(pkg)}`;
    const frame = document.getElementById('sp-frame');

    // Modal + iframe varsa onu kullan
    if (frame && typeof window.openSP === 'function') {
      frame.src = url;
      window.openSP();
    } else {
      // Her ihtimale karşı: modal yoksa tam sayfaya git
      window.location.href = url;
    }
  }

  /* -------------------- DOM -------------------- */
  const hero = $('#hero');
  const player = $('#player');
  const backHome = $('#backHome');
  const lesson = $('#lesson');
  const moduleTitle = $('#moduleTitle');
  const trainingSection = $('#training');
  const trainingSelection = $('#trainingSelection');
  const topicsSection = $('#topics');
  const topicsE1 = $('#topics-egitim1');
  const topicsE2 = $('#topics-egitim2');
  let subtopicsSection = null;

  const trainingCards = () => $$('.training-card');
  function showTopics(which){
    hide(topicsE1); hide(topicsE2);
    if (which==='egitim1') show(topicsE1);
    if (which==='egitim2') show(topicsE2);
    show(topicsSection); scrollToEl(topicsSection);
    document.body.classList.remove('has-subtopics');
  }
  function bindTraining(){
    trainingCards().forEach(card=>{
      card.addEventListener('click',()=>{
        trainingCards().forEach(c=>c.setAttribute('aria-pressed','false'));
        card.setAttribute('aria-pressed','true');
        const id=card.dataset.id;
        if(trainingSelection) trainingSelection.textContent=`Seçildi: ${id==='egitim1'?'Eğitim 1':'Eğitim 2'}`;
        showTopics(id);
      });
    });
  }

  const indexFromTopicId=t=>{const m=String(t||'').match(/e1-(\d+)/i);return m?parseInt(m[1],10)-1:-1;};

  function resolveChildPath({moduleId,parentSlug,child}){
    // Orijinal davranış: eğer child.path veya child.file varsa kullan.
    if(child.path) return child.path;
    if(child.file) return `modules/${moduleId}/${parentSlug}/${child.file}`;
    // Eğer child.id tam bir klasör adıysa (örn: 'warning-system'), döküman yerine klasör-manifest yolu gerekiyor.
    const slug = child.slug || slugifyTitle(child.title || child.id || 'konu');
    const fname = child.id ? `${child.id}.json` : `${slug}.json`;
    // dönmesi gereken klasik path (eski davranış)
    return `modules/${moduleId}/${parentSlug}/${fname}`;
  }

  // ---------- Yeni: çoklu fallback denemesi ----------
  async function tryPathsSequential(paths){
    const tried = [];
    for (const p of paths){
      tried.push(p);
      try {
        const data = await fetchJSON(p);
        console.debug('[tryPathsSequential] success:', p);
        return {data, path: p, tried};
      } catch (err){
        console.warn('[tryPathsSequential] fail:', p, err?.message || err);
        // devam et
      }
    }
    const e = new Error('Tüm yollar denenip başarısız oldu');
    e.tried = tried;
    throw e;
  }

  // 🔹 GÜNCELLENMİŞ openSubtopic (robust fallback'li)
  async function openSubtopic({ moduleId = 'egitim1', parentSlug, childMeta }) {
    try {
      // Öneri: childMeta.id genellikle 'warning-system' veya 'general' gibi geliyor
      const childId = (childMeta && (childMeta.id || childMeta.slug || slugifyTitle(childMeta.title || ''))) || '';
      const childFile = (childMeta && childMeta.file) || '';
      const manualPath = childMeta && childMeta.path ? childMeta.path : null;

      // Temel candidate listelerini oluştur
      const candidates = [];

      // 1) Eğer child.path verildiyse onu ilk dene (kullanıcı override)
      if (manualPath) {
        candidates.push(manualPath);
      }

      // 2) Orijinal (eski) davranış: modules/<moduleId>/<parentSlug>/<childFile or childId>.json
      if (childFile) candidates.push(`modules/${moduleId}/${parentSlug}/${childFile}`);
      if (childId) candidates.push(`modules/${moduleId}/${parentSlug}/${childId}.json`);

      // 3) Eğer childId klasör olarak tutuluyorsa: modules/.../<parentSlug>/<childId>/manifest.json
      if (childId) candidates.push(`modules/${moduleId}/${parentSlug}/${childId}/manifest.json`);
      // veya kök egitim1 altındaki paket yolu (slideplayer kullandığın format)
      if (childId) candidates.push(`${moduleId}/${parentSlug}/${childId}/manifest.json`);
      if (childId) candidates.push(`${moduleId}/${parentSlug}/${childId}.json`);

      // 4) Fallback: modules/<moduleId>/<parentSlug>/<slugified-title>.json
      const fallbackSlug = slugifyTitle(childMeta && (childMeta.title || childMeta.id || 'konu'));
      if (fallbackSlug && fallbackSlug !== childId) candidates.push(`modules/${moduleId}/${parentSlug}/${fallbackSlug}.json`);
      if (fallbackSlug && fallbackSlug !== childId) candidates.push(`${moduleId}/${parentSlug}/${fallbackSlug}.json`);

      // 5) Son çare: modules/<moduleId>/<childId>.json (bazı yapılar bu formatta olabilir)
      if (childId) candidates.push(`modules/${moduleId}/${childId}.json`);
      // Log: hangi yollar denenecek
      console.debug('[openSubtopic] tried candidates for', childId, candidates);

      // Denemeyi yap
      const { data, path, tried } = await tryPathsSequential(candidates);

      // Eğer dönen veri topics dizisi ise subtopics render et
      if (Array.isArray(data.topics) && data.topics.length) {
        renderSubtopics(data, data.title, { moduleId, parentSlug });
        return;
      }

      // Eğer root-level html/title varsa onu göster
      if (data.html || data.title) {
        hide(topicsSection);
        if (subtopicsSection) { subtopicsSection.remove(); subtopicsSection = null; }
        document.body.classList.remove('has-subtopics');
        show(player);
        if (moduleTitle) moduleTitle.textContent = data.title || 'Ders';
        lesson.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'lesson-section';
        if (data.title) {
          const h = document.createElement('h3');
          h.textContent = data.title;
          wrap.appendChild(h);
        }
        if (data.html) {
          const div = document.createElement('div');
          div.innerHTML = data.html;
          wrap.appendChild(div);
        }
        lesson.appendChild(wrap);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      // Eğer content array varsa render et
      if (Array.isArray(data.content) && data.content.length) {
        hide(topicsSection);
        if (subtopicsSection){subtopicsSection.remove();subtopicsSection=null;}
        document.body.classList.remove('has-subtopics');
        show(player);
        if (moduleTitle) moduleTitle.textContent = data.title || 'Ders';
        renderLesson(data);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      // Eğer manifest (slide paket) döndüyse — destekle (manifest içinde pages/Slides vs olabilir)
      if (data && (data.pages || data.slidesDir || data.slides)) {
        // Burada manifest döndü: slide-player'ı açacak şekilde davran
        // path değişkeninden klasör yolunu türetmeye çalış:
        let pkgCandidate = null;
        // Eğer path .../manifest.json şeklindeyse klasörü al
        if (path && path.endsWith('/manifest.json')) {
          pkgCandidate = path.replace(/\/manifest\.json(\?.*)?$/,'');
        } else {
          // Eğer path .../<something>.json ise klasör yok — yine deneyebiliriz
          if (childId) pkgCandidate = `${moduleId}/${parentSlug}/${childId}`;
        }
        if (pkgCandidate) {
          pkgCandidate = pkgCandidate.replace(/^modules\//,'').replace(/^\/+/,'');
          console.debug('[openSubtopic] manifest-as-slidepkg -> redirecting to slide-player with pkg=', pkgCandidate);
          window.location.href = `slide-player.html?pkg=${encodeURIComponent(pkgCandidate)}`;
          return;
        }
      }

      alert('Bu başlık için içerik henüz eklenmemiş.');
    } catch (err) {
      console.error('[openSubtopic] Hata detayları:', err);
      let msg = 'Alt konu yüklenemedi: ' + (err?.message || 'Network/JSON');
      if (err && err.tried) {
        msg += '\nDenenen yollar:\n' + err.tried.join('\n');
      }
      alert(msg);
    }
  }

  function renderSubtopics(topic,fallbackTitle,opt={}){
    const {moduleId='egitim1',parentSlug=slugifyTitle(topic.id||topic.title||fallbackTitle||'topic')}=opt;
    hide(topicsSection); if(subtopicsSection) subtopicsSection.remove();
    subtopicsSection=document.createElement('section');
    subtopicsSection.id='subtopics'; subtopicsSection.className='section-wrap';
    subtopicsSection.innerHTML=`
      <h2>${topic.title||fallbackTitle||''}</h2>
      ${topic.summary?`<p class="topic-summary">${topic.summary}</p>`:''}
      <div class="training-grid" id="subtopicGrid"></div>`;
    const grid=$('#subtopicGrid',subtopicsSection);

    (topic.topics || []).forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'training-card';
      btn.innerHTML = `
        <div class="training-card-body">
          <h3>${t.title || 'Konu'}</h3>
          ${t.type ? `<p class="type"><em>${t.type}</em></p>` : ''}
          ${t.description ? `<p class="desc">${t.description}</p>` : ''}
        </div>`;

      // 🔹 Bu alt konu slide-player ile mi açılacak?
      const childId = t.id || slugifyTitle(t.title || '');
      const mapKey  = `${parentSlug}/${childId}`;          // örn: "airplane-general/general"
      const slidePkg = slideLessonMap[mapKey];

      if (slidePkg) {
        btn.dataset.slideKey = mapKey;
        btn.dataset.slidePkg = slidePkg;
      }

      btn.addEventListener('click', () => {
        const pkg = btn.dataset.slidePkg;
        if (pkg) {
          // JSON yerine direkt SlidePlayer çalışsın
          openSlidePlayerWithPkg(pkg);
        } else {
          // Normal JSON tabanlı ders akışı
          openSubtopic({moduleId,parentSlug,childMeta:t});
        }
      });

      grid.appendChild(btn);
    });

    $('main').appendChild(subtopicsSection);
    document.body.classList.add('has-subtopics');
    scrollToEl(subtopicsSection);
  }

  const E1_SLUGS=[
    'airplane-general',
    'hydraulics',
    'electrical',
    'lighting',
    'avionics1',
    'avionics2',
    'avionics3',
    'auto-flight-system',
    'radio-navigation',
    'flight-management'
  ];

  const E2_SLUG_ALIASES = {
    apu: 'power-system'
  };

  async function openTopicByIndexE1(idx){
    try{
      if(idx<0||idx>=E1_SLUGS.length){alert('Konu indeksinde bulunamadı.');return;}
      const slug=E1_SLUGS[idx];
      const path=`modules/egitim1/${slug}.json`;
      const topic=await fetchJSON(path);
      renderSubtopics(topic,topic.title||slug.replace(/-/g,' '),{moduleId:'egitim1',parentSlug:slug});
    }catch(e){console.error(e);alert('Konu yüklenemedi.');}
  }

  async function openTopicByTitleE2(btn){
    try{
      const title=(btn.querySelector('h3')||btn).textContent.trim();
      const rawSlug=slugifyTitle(title);
      const slug=E2_SLUG_ALIASES[rawSlug] || rawSlug;
      const topic=await fetchJSON(`modules/egitim2/${slug}.json`);
      renderSubtopics(topic,title,{moduleId:'egitim2',parentSlug:slug});
    }catch(e){console.error(e);alert('Konu yüklenemedi.');}
  }

  function bindTopics(){
    $$('.topic-card',topicsE1).forEach(c=>c.addEventListener('click',()=>{
      const idx=indexFromTopicId(c.dataset.topicId);
      if(idx<0){alert('Bu konu henüz aktif değil.');return;}
      openTopicByIndexE1(idx);
    }));
    $$('.topic-card',topicsE2).forEach(c=>c.addEventListener('click',()=>openTopicByTitleE2(c)));
  }

  function renderLesson(mod){
    if(!lesson)return;
    lesson.innerHTML='';
    (mod.content||[]).forEach(b=>{
      if(b.type==='text'){const p=document.createElement('p');p.textContent=b.text;lesson.appendChild(p);}
      else if(b.type==='html'){const d=document.createElement('div');d.innerHTML=b.html;lesson.appendChild(d);}
      else if(b.type==='image'){const i=document.createElement('img');i.src=b.src;i.alt=b.alt||'';i.loading='lazy';i.decoding='async';i.style.maxWidth='100%';lesson.appendChild(i);}
    });
  }

  function bindHero(){
    const plane=$('#plane-learjet'); if(!plane||!trainingSection)return;
    const go=()=>{show(trainingSection);scrollToEl(trainingSection);const f=trainingCards()[0];if(f){trainingCards().forEach(c=>c.setAttribute('aria-pressed','false'));f.setAttribute('aria-pressed','true');if(trainingSelection)trainingSelection.textContent='Seçildi: Eğitim 1';}};
    plane.addEventListener('click',go);
    plane.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});
  }

  if(backHome){
    backHome.addEventListener('click',()=>{
      hide(player);lesson.innerHTML='';moduleTitle.textContent='';
      show(hero);show(trainingSection);hide(topicsSection);hide(topicsE1);hide(topicsE2);
      if(subtopicsSection){subtopicsSection.remove();subtopicsSection=null;}
      document.body.classList.remove('has-subtopics');scrollToEl(trainingSection);
    });
  }

  const installBtn=$('#installBtn');let deferred=null;
  if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js?v=rs9').then(()=>console.log('✅ SW')).catch(console.error);}
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;if(installBtn)installBtn.hidden=false;});
  if(installBtn)installBtn.addEventListener('click',async()=>{installBtn.hidden=true;if(!deferred)return;deferred.prompt();await deferred.userChoice;deferred=null;});

  // SlidePlayer ders haritasını arka planda yükle
  loadSlideLessonConfig();

  window.addEventListener('DOMContentLoaded',()=>{bindHero();bindTraining();bindTopics();});
})();
