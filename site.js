import {mountScenes} from './scene-ui.js';
const d=window.R2G;
const entries=d.models.models||[];
const models=Array.isArray(entries)?Object.fromEntries(entries.map(m=>[m.scene+'/'+m.variant,m])):entries;
mountScenes(document.querySelector('#real2sim-viewer'),d.scenes.sections[0].scenes,models);
mountScenes(document.querySelector('#augmentation-viewer'),d.scenes.sections[1].scenes,models,true);
window.mountAgent('#agent-viewer',d.agent);
if(window.mountRobot)window.mountRobot('#robot-viewer',d.metadata.robot);
document.querySelector('#copy-citation').onclick=async()=>{const text=document.querySelector('#bibtex').textContent;try{await navigator.clipboard.writeText(text);document.querySelector('#copy-status').textContent='Copied.'}catch{const range=document.createRange();range.selectNodeContents(document.querySelector('#bibtex'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.querySelector('#copy-status').textContent='Select and copy the citation.'}};

const autoVideos=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.muted=true;e.target.play().catch(()=>{})}else e.target.pause()}),{threshold:.5});document.querySelectorAll(".overview-video video, #agent-viewer video").forEach(v=>autoVideos.observe(v));
