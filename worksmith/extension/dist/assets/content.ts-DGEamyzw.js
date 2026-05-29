(function(){const H={A:t=>t.hasAttribute("href")?"link":null,ARTICLE:"article",ASIDE:"complementary",BUTTON:"button",DETAILS:"group",DIALOG:"dialog",FOOTER:"contentinfo",FORM:"form",H1:"heading",H2:"heading",H3:"heading",H4:"heading",H5:"heading",H6:"heading",HEADER:"banner",IMG:"img",INPUT:B,LI:"listitem",MAIN:"main",NAV:"navigation",OL:"list",OPTION:"option",PROGRESS:"progressbar",SECTION:"region",SELECT:"combobox",TABLE:"table",TBODY:"rowgroup",TD:"cell",TEXTAREA:"textbox",TH:"columnheader",THEAD:"rowgroup",TR:"row",UL:"list"};function A(){let t=0;const e=document.body||document.documentElement,r=n(e,0);return{nodeCount:t,tree:r||{role:"document",name:document.title||location.href,tag:"document",children:[]}};function n(o,i){if(!o||t>=1200||i>24||U(o))return null;t+=1;const l=R(o),u=W(o),d=D(o),f=$(o),x=j(o),E=I(o)??O(o,x),S=X(o),b=[];for(const M of Array.from(o.children)){const T=n(M,i+1);if(T&&b.push(T),t>=1200)break}return l||u||d||Object.keys(f).length>0||b.length>0||E||S?Y({role:l||"generic",name:u,tag:o.tagName.toLowerCase(),text:d,selector:P(o),state:f,rect:x,src:E??void 0,href:S??void 0,children:b}):null}}function I(t){var r;const e=t.tagName;if(e==="IMG"){const n=t;return n.currentSrc||n.src||null}if(e==="SOURCE"){const n=t.src;if(n)return n;const o=t.getAttribute("srcset");if(o)return((r=o.split(",")[0])==null?void 0:r.trim().split(/\s+/)[0])??null}return null}function O(t,e){const r=t.tagName;if(r==="IMG"||r==="SOURCE"||!e||e.width<16||e.height<16)return null;let n;try{n=window.getComputedStyle(t).backgroundImage}catch{return null}if(!n||n==="none")return null;const o=/url\(['"]?([^'")]+)['"]?\)/i.exec(n);if(!o)return null;const i=o[1].trim();if(!i||i.startsWith("data:"))return null;try{const l=new URL(i,window.location.href).href;return/^https?:/i.test(l)?l:null}catch{return null}}function X(t){if(t.tagName==="A"||t.tagName==="AREA"){const e=t.href;return!e||e.startsWith("javascript:")||e===window.location.href+"#"?null:e}return null}function R(t){const e=t.getAttribute("role");if(e)return e;const r=H[t.tagName];return typeof r=="function"?r(t):r||null}function B(t){const e=(t.getAttribute("type")||"text").toLowerCase();return{button:"button",checkbox:"checkbox",email:"textbox",number:"spinbutton",password:"textbox",radio:"radio",range:"slider",search:"searchbox",submit:"button",tel:"textbox",text:"textbox",url:"textbox"}[e]||"textbox"}function W(t){const e=t.getAttribute("aria-label");if(e)return a(e);const r=t.getAttribute("aria-labelledby");if(r){const n=r.split(/\s+/).map(o=>{var i;return((i=document.getElementById(o))==null?void 0:i.textContent)||""}).join(" ");if(a(n))return a(n)}if(t instanceof HTMLImageElement)return a(t.alt||t.title||"");if(t instanceof HTMLInputElement){const n=w(t);return a(n||t.value||t.placeholder||t.title||"")}if(t instanceof HTMLTextAreaElement){const n=w(t);return a(n||t.placeholder||t.title||"")}return t instanceof HTMLSelectElement?a(w(t)||t.title||""):t instanceof HTMLButtonElement||t.tagName==="A"?a(t.textContent||t.getAttribute("title")||""):/^H[1-6]$/.test(t.tagName)?a(t.textContent||""):a(t.getAttribute("title")||"")}function w(t){var r;const e=t.id;if(e){const n=document.querySelector(`label[for="${y(e)}"]`);if(n)return n.textContent||""}return((r=t.closest("label"))==null?void 0:r.textContent)||""}function D(t){const e=Array.from(t.childNodes).filter(r=>r.nodeType===Node.TEXT_NODE).map(r=>r.textContent).join(" ");return a(e)}function $(t){const e={};return["aria-checked","aria-disabled","aria-expanded","aria-hidden","aria-pressed","aria-selected"].forEach(n=>{t.hasAttribute(n)&&(e[n.replace("aria-","")]=t.getAttribute(n)||"")}),"disabled"in t&&t.disabled&&(e.disabled=!0),"checked"in t&&t.checked&&(e.checked=!0),t.hidden&&(e.hidden=!0),e}function j(t){const e=t.getBoundingClientRect();return!e.width&&!e.height?null:{x:h(e.x),y:h(e.y),width:h(e.width),height:h(e.height)}}function P(t){if(t.id)return`#${y(t.id)}`;const e=[];let r=t;for(;r&&r.nodeType===Node.ELEMENT_NODE&&e.length<4;){let n=r.tagName.toLowerCase();r.classList.length&&(n+=`.${Array.from(r.classList).slice(0,2).map(y).join(".")}`);const o=r.parentElement;if(o){const i=Array.from(o.children).filter(l=>l.tagName===r.tagName);i.length>1&&(n+=`:nth-of-type(${i.indexOf(r)+1})`)}e.unshift(n),r=o}return e.join(" > ")}function U(t){const e=t.tagName;if(["SCRIPT","STYLE","META","LINK","NOSCRIPT","TEMPLATE"].includes(e)||t.getAttribute("aria-hidden")==="true")return!0;const r=window.getComputedStyle(t);return r.display==="none"||r.visibility==="hidden"}function a(t){const e=String(t||"").replace(/\s+/g," ").trim();return e.length>140?`${e.slice(0,140)}...`:e}function Y(t){const e={};return Object.entries(t).forEach(([r,n])=>{n==null||n===""||Array.isArray(n)&&n.length===0||typeof n=="object"&&!Array.isArray(n)&&Object.keys(n).length===0||(e[r]=n)}),e}function h(t){return Math.round(t*100)/100}function y(t){var e;return typeof((e=window.CSS)==null?void 0:e.escape)=="function"?CSS.escape(t):String(t).replace(/[^a-zA-Z0-9_-]/g,"\\$&")}const N=350,F=500,q=60;let m=location.href,s=null;chrome.runtime.onMessage.addListener((t,e,r)=>{if((t==null?void 0:t.type)==="worksmith.ping")return r({ok:!0}),!0;if((t==null?void 0:t.type)==="worksmith.captureAccessibility"){try{const n=A();r({ok:!0,url:location.href,title:document.title,nodeCount:n.nodeCount,tree:n.tree})}catch(n){r({ok:!1,error:C(n)})}return!0}if((t==null?void 0:t.type)==="worksmith.captureMoment"){try{const n=A(),o=g();r({ok:!0,url:location.href,title:document.title,nodeCount:n.nodeCount,tree:n.tree,scrollState:o,scrollSignature:_(o)})}catch(n){r({ok:!1,error:C(n)})}return!0}if((t==null?void 0:t.type)==="worksmith.getScrollState"){const n=g();return r({ok:!0,url:location.href,title:document.title,scrollState:n,scrollSignature:_(n)}),!0}if((t==null?void 0:t.type)==="worksmith.flash")return G(),r({ok:!0}),!0;if((t==null?void 0:t.type)==="worksmith.ring.show")return Z({create:t.create===!0}),r({ok:!0}),!0;if((t==null?void 0:t.type)==="worksmith.ring.hide")return J(),requestAnimationFrame(()=>{requestAnimationFrame(()=>{setTimeout(()=>r({ok:!0}),40)})}),!0;if((t==null?void 0:t.type)==="worksmith.ring.dismiss")return K(),r({ok:!0}),!0;if((t==null?void 0:t.type)==="worksmith.scrollStep"){const n=typeof t.by=="number"?t.by:0,o=typeof t.to=="number"?t.to:null;o!==null?window.scrollTo({top:o,left:0,behavior:"auto"}):window.scrollBy({top:n,left:0,behavior:"auto"});const i=g();return r({ok:!0,scrollState:i,url:location.href,title:document.title}),!0}return!1});function z(){if(document.getElementById("__worksmith_flash_kf__"))return;const t=document.createElement("style");t.id="__worksmith_flash_kf__",t.textContent=`
    @property --ws-angle { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
    #__worksmith_flash__ {
      position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
      padding: 7px;
      background: conic-gradient(from var(--ws-angle, 0deg),
        #f472b6 0deg, #fbe055 90deg, #f472b6 180deg, #fbe055 270deg, #f472b6 360deg);
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
              mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite: source-out;
              mask-composite: exclude;
      opacity: 0; filter: blur(0);
      animation: ws-flash-fade 1100ms ease-out forwards, ws-flash-rotate 1100ms linear forwards;
    }
    @keyframes ws-flash-fade {
      0% { opacity: 0; filter: blur(2px); }
      18% { opacity: 0.95; filter: blur(0); }
      60% { opacity: 0.65; }
      100% { opacity: 0; }
    }
    @keyframes ws-flash-rotate { to { --ws-angle: 540deg; } }
  `,document.documentElement.appendChild(t)}function G(){var e;z(),(e=document.getElementById("__worksmith_flash__"))==null||e.remove();const t=document.createElement("div");t.id="__worksmith_flash__",document.documentElement.appendChild(t),setTimeout(()=>t.remove(),1200)}function V(){if(document.getElementById("__worksmith_ring_kf__"))return;const t=document.createElement("style");t.id="__worksmith_ring_kf__",t.textContent=`
    @property --ws-ring-angle { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
    #__worksmith_ring__ {
      position: fixed; inset: 0; pointer-events: none;
      z-index: 2147483647;
      /* Asymmetric conic with a tight bright "peak" near 160° so the
         orbit reads as a moving comet, not just a colour wheel. The peak
         is the single most-visible motion cue at a glance. */
      background: conic-gradient(from var(--ws-ring-angle, 0deg),
        #f472b6 0deg,
        #fb923c 80deg,
        #fde047 140deg,
        #ffffff 162deg,
        #fde047 184deg,
        #d946ef 280deg,
        #f472b6 360deg);
      /* Crossing linear gradients masked to a narrow band along each edge
         of the viewport. Each axis is fully opaque at the edge (0px) and
         fully transparent by 80px inward — so the actual "ring" is only
         the outer ~80px on every side, fading from full colour at the
         edge to nothing as you move toward centre. Centre stays
         completely clear instead of being half-lit by a 50%-stop gradient.
         Pixel-based stops keep the band a uniform thickness regardless of
         viewport aspect ratio (a 50% stop on a wide screen had the
         horizontal fade reach much further than the vertical). */
      -webkit-mask:
        linear-gradient(to right,
          black 0,
          transparent 80px,
          transparent calc(100% - 80px),
          black 100%),
        linear-gradient(to bottom,
          black 0,
          transparent 80px,
          transparent calc(100% - 80px),
          black 100%);
              mask:
        linear-gradient(to right,
          black 0,
          transparent 80px,
          transparent calc(100% - 80px),
          black 100%),
        linear-gradient(to bottom,
          black 0,
          transparent 80px,
          transparent calc(100% - 80px),
          black 100%);
      filter: blur(2px) saturate(140%) brightness(120%);
      opacity: 0;
      transition: opacity 220ms ease-out;
      /* 3s/360° — fast enough that the peak's position is clearly
         changing every blink, slow enough to feel calm rather than frantic. */
      animation: ws-ring-rotate 3s linear infinite;
      will-change: opacity, --ws-ring-angle;
    }
    #__worksmith_ring__.__ws-on__ { opacity: 1; }
    @keyframes ws-ring-rotate { to { --ws-ring-angle: 360deg; } }
  `,document.documentElement.appendChild(t)}function Z({create:t}){let e=document.getElementById("__worksmith_ring__");if(!e){if(!t)return;V(),e=document.createElement("div"),e.id="__worksmith_ring__",document.documentElement.appendChild(e),requestAnimationFrame(()=>{e.classList.add("__ws-on__")});return}e.style.display="",e.classList.add("__ws-on__")}function J(){const t=document.getElementById("__worksmith_ring__");t&&(t.style.display="none")}function K(){var t;(t=document.getElementById("__worksmith_ring__"))==null||t.remove()}document.addEventListener("scroll",()=>{s||(s=setTimeout(()=>{s=null,p()},N))},{capture:!0,passive:!0});window.addEventListener("scroll",()=>{s||(s=setTimeout(()=>{s=null,p()},N))},{passive:!0});window.addEventListener("hashchange",k);window.addEventListener("popstate",k);setInterval(()=>{location.href!==m&&k()},F);p();function p(){const t=g();v({type:"worksmith.scroll",payload:{url:location.href,...t.page,scrollState:t,scrollSignature:_(t)}})}function g(){const t=document.documentElement,e=document.body,r=Math.max((t==null?void 0:t.scrollHeight)||0,(e==null?void 0:e.scrollHeight)||0),n=Math.max((t==null?void 0:t.scrollWidth)||0,(e==null?void 0:e.scrollWidth)||0),o=window.innerHeight||t.clientHeight||0,i=window.innerWidth||t.clientWidth||0,l=Math.max(r-o,0),u=Math.max(n-i,0),d=window.scrollY||t.scrollTop||0,f=window.scrollX||t.scrollLeft||0;return{page:{scrollX:c(f),scrollY:c(d),scrollPercent:c(l>0?d/l*100:0),scrollXPercent:c(u>0?f/u*100:0),viewportWidth:i,viewportHeight:o,documentWidth:n,documentHeight:r},boxes:Q(i,o)}}function Q(t,e){const r=[],n=document.querySelectorAll("body *");for(const o of Array.from(n)){if(r.length>=q)break;if(!tt(o))continue;const i=o.getBoundingClientRect();et(i,t,e)&&r.push({selector:nt(o),tag:o.tagName.toLowerCase(),role:o.getAttribute("role"),name:rt(o),scrollTop:c(o.scrollTop),scrollLeft:c(o.scrollLeft),scrollHeight:c(o.scrollHeight),scrollWidth:c(o.scrollWidth),clientHeight:c(o.clientHeight),clientWidth:c(o.clientWidth),rect:{x:c(i.x),y:c(i.y),width:c(i.width),height:c(i.height)}})}return r}function tt(t){if(!(t instanceof Element))return!1;const e=window.getComputedStyle(t);if(e.display==="none"||e.visibility==="hidden")return!1;const r=e.overflowY,n=e.overflowX,o=t.scrollHeight-t.clientHeight>2&&/(auto|scroll|overlay)/.test(r),i=t.scrollWidth-t.clientWidth>2&&/(auto|scroll|overlay)/.test(n);return o||i}function et(t,e,r){return t.width<8||t.height<8?!1:t.bottom>0&&t.right>0&&t.top<r&&t.left<e}function _(t){const e=t.page,r=t.boxes.map(n=>[n.selector,n.scrollTop,n.scrollLeft,n.clientHeight,n.clientWidth].join(":"));return JSON.stringify({page:[e.scrollX,e.scrollY,e.viewportWidth,e.viewportHeight,e.documentWidth,e.documentHeight],boxes:r})}function k(){const t=m;m=location.href,v({type:"worksmith.route.changed",payload:{previousUrl:t,url:location.href,title:document.title}}),p()}function v(t){chrome.runtime.sendMessage(t).catch(()=>{})}function rt(t){return ot(t.getAttribute("aria-label")||t.getAttribute("title")||t.textContent||"")}function nt(t){if(t.id)return`#${L(t.id)}`;const e=[];let r=t;for(;r&&r.nodeType===Node.ELEMENT_NODE&&e.length<4;){let n=r.tagName.toLowerCase();r.classList.length&&(n+=`.${Array.from(r.classList).slice(0,2).map(L).join(".")}`);const o=r.parentElement;if(o){const i=Array.from(o.children).filter(l=>l.tagName===r.tagName);i.length>1&&(n+=`:nth-of-type(${i.indexOf(r)+1})`)}e.unshift(n),r=o}return e.join(" > ")}function ot(t){const e=String(t||"").replace(/\s+/g," ").trim();return e.length>80?`${e.slice(0,80)}...`:e}function L(t){var e;return typeof((e=window.CSS)==null?void 0:e.escape)=="function"?CSS.escape(t):String(t).replace(/[^a-zA-Z0-9_-]/g,"\\$&")}function c(t){return Math.round(t*100)/100}function C(t){return t instanceof Error?t.message:String(t)}
})()
