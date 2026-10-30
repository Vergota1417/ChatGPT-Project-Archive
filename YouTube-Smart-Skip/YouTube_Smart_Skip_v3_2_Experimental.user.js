// ==UserScript==
// @name         YouTube Smart Skip v3.2 Experimental
// @namespace    https://github.com/Vergota1417/ChatGPT-Project-Archive
// @version      3.2.0
// @description  Experimental player-level ad cancellation, mute/speed fallback and safe restore.
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(() => {
  'use strict';
  if (window.__ytSmartSkip32) return;
  const stats={version:'3.2.0',ads:0,cancelAttempts:0,skipClicks:0,cleared:0,last:'Starting'};
  let player=null, session=null, timer=0, observer=null;
  const log=(s)=>{stats.last=s; console.debug('[YT Smart Skip 3.2]',s)};
  const active=p=>!!p&&(p.classList.contains('ad-interrupting')||p.classList.contains('ad-showing'));
  const schedule=(ms=350)=>{clearTimeout(timer);timer=setTimeout(scan,ms)};
  const visible=b=>!!b&&b.isConnected&&!b.disabled&&!b.closest('[aria-hidden="true"]')&&b.getClientRects().length>0&&getComputedStyle(b).visibility!=='hidden';
  const selectors='button.ytp-skip-ad-button,button.ytp-ad-skip-button,button.ytp-ad-skip-button-modern';
  function restore(){
    if(!session)return;
    const {video,rate,muted}=session;
    if(video?.isConnected){
      try{video.playbackRate=rate}catch{}
      try{video.muted=muted}catch{}
    }
    if(session.acted)stats.cleared++;
    session=null;log('Watching');
  }
  function begin(p){
    const video=p.querySelector('video.html5-main-video')||p.querySelector('video');
    session={video,rate:video?.playbackRate??1,muted:video?.muted??false,cancelled:false,clicked:false,acted:false};
    stats.ads++;log('Ad detected');
  }
  function handle(p){
    if(!session)return;
    const s=session,v=s.video;
    if(v?.isConnected){
      try{v.muted=true}catch{}
      try{if(v.playbackRate<8)v.playbackRate=8}catch{}
    }
    if(!s.cancelled && v && !v.paused && v.readyState>=2){
      s.cancelled=true;s.acted=true;stats.cancelAttempts++;
      try{if(typeof p.cancelPlayback==='function')p.cancelPlayback()}catch(e){log('cancelPlayback unavailable: '+String(e))}
    }
    if(!s.clicked){
      const b=[...p.querySelectorAll(selectors)].find(visible);
      if(b){
        s.clicked=true;s.acted=true;stats.skipClicks++;
        try{b.click()}catch(e){log('Click rejected: '+String(e))}
      }
    }
  }
  function scan(){
    const p=document.querySelector('#movie_player');
    if(p!==player){
      observer?.disconnect();player=p;
      if(p){
        observer=new MutationObserver(()=>schedule(120));
        observer.observe(p,{attributes:true,childList:true,subtree:true,attributeFilter:['class','style','aria-hidden','disabled']});
      }
    }
    if(!active(p)){
      restore();schedule(1100);return;
    }
    if(!session)begin(p);
    handle(p);
    schedule(450);
  }
  window.__ytSmartSkip32={stats:()=>({...stats,active:!!session}),scan};
  window.addEventListener('yt-navigate-finish',()=>schedule(100));
  window.addEventListener('pagehide',restore);
  schedule(100);
})();