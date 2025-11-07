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

  /* -------------------- PWA splash -------------------- */
  (function ensureStandaloneFlag(){
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone;
    if (isStandalone) document.documentElement.classList.add('standalone');
  })();

  (function splashWithAudio(){
    const isStandalone = document.documentElement.classList.contains('standalone');
    if (!isStandalone) return;
    const splash = $('#splash');
    const video  = $('#splashVideo');
    if (!splash) return;
    const audio = new Audio('assets/splash/intro.mp3');
    audio.volume = 1.0;
    let tried = false;
    const playAudio = () => {
      if (tried) return; tried = true;
      audio.play().catch(() => {
        const resume = () => { audio.play().catch(()=>{}); window.removeEventListener('pointerdown', resume); window.removeEventListener('keydown', resume); };
        window.addEventListener('pointerdown', resume, { once:true });
        window.addEventListener('keydown', resume, { once:true });
      });
    };
    const closeSplash = () => { splash.classList.add('hide'); setTimeout(()=>{ try{audio.pause();}catch{} splash.remove(); },480); };
    if (video){
      let closed=false; const tryClose=()=>{if(!closed){closed=true;closeSplash();}};
      video.addEventListener('playing',()=>{playAudio();setTimeout(tryClose,3000);});
      setTimeout(()=>{playAudio();tryClose();},3000);
    } else { playAudio(); setTimeout(closeSplash,3000); }
  })();

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
    if(child.path) return child.path;
    if(child.file) return `modules/${moduleId}/${parentSlug}/${child.file}`;
    const slug=child.slug||slugifyTitle(child.title||child.id||'konu');
    const fname=child.id?`${child.id}.json`:`${slug}.json`;
    return `modules/${moduleId}/${parentSlug}/${fname}`;
  }

  // 🔹 PATCH’Lİ openSubtopic
  async function openSubtopic({ moduleId, parentSlug, childMeta }) {
    try {
      const path = resolveChildPath({ moduleId, parentSlug, child: childMeta });
      console.debug('[openSubtopic] path:', path);
      const data = await fetchJSON(path);

      if (Array.isArray(data.topics) && data.topics.length) {
        renderSubtopics(data, data.title, { moduleId, parentSlug });
        return;
      }

      // ✅ YENİ: root-level html/title içeren içerikleri kabul et
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

      alert('Bu başlık için içerik henüz eklenmemiş.');
    } catch (err) {
      console.error('[openSubtopic] Hata:', err);
      alert('Alt konu yüklenemedi: ' + (err?.message || 'Network/JSON'));
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
    (topic.topics||[]).forEach(t=>{
      const btn=document.createElement('button');
      btn.className='training-card';
      btn.innerHTML=`
        <div class="training-card-body">
          <h3>${t.title||'Konu'}</h3>
          ${t.type?`<p class="type"><em>${t.type}</em></p>`:''}
          ${t.description?`<p class="desc">${t.description}</p>`:''}
        </div>`;
      btn.addEventListener('click',()=>openSubtopic({moduleId,parentSlug,childMeta:t}));
      grid.appendChild(btn);
    });
    $('main').appendChild(subtopicsSection);
    document.body.classList.add('has-subtopics');
    scrollToEl(subtopicsSection);
  }

  const E1_SLUGS=['airplane-general','hydraulics','electrical','lighting','avionics','auto-flight-system','radio-navigation','flight-management'];

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
      const slug=slugifyTitle(title);
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

  window.addEventListener('DOMContentLoaded',()=>{bindHero();bindTraining();bindTopics();});
})();
