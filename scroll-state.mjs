function elementPath(element){
 if(element.id)return '#'+CSS.escape(element.id);
 const parts=[];while(element&&element!==document.body){const parent=element.parentElement;if(!parent)break;const siblings=[...parent.children].filter(n=>n.tagName===element.tagName);parts.unshift(element.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(element)+1)+')');element=parent;}return 'body > '+parts.join(' > ');
}
function anchorFor(container){const bounds=container.getBoundingClientRect();const rows=[...container.querySelectorAll('[data-select-conversation],[data-open-contact],tr[data-action="edit-crm-contact"]')];const row=rows.find(row=>row.getBoundingClientRect().bottom>bounds.top&&row.getBoundingClientRect().top<bounds.bottom);if(!row)return null;const key=['data-select-conversation','data-open-contact','data-id'].find(k=>row.hasAttribute(k));return {key,value:row.getAttribute(key),offset:row.getBoundingClientRect().top-bounds.top};}
export function captureScrollState(){
 const positions=[...document.querySelectorAll('body *')].filter(e=>e.scrollTop||e.scrollLeft||e.scrollHeight>e.clientHeight+1&&e.clientHeight>0&&['auto','scroll'].includes(getComputedStyle(e).overflowY)).map(e=>({path:elementPath(e),top:e.scrollTop,left:e.scrollLeft,anchor:e.id==='thread-messages'?null:anchorFor(e)}));
 const focused=document.activeElement;return {x:window.scrollX,y:window.scrollY,positions,focus:focused&&focused!==document.body?{path:elementPath(focused),start:focused.selectionStart,end:focused.selectionEnd}:null};
}
export function restoreScrollState(snapshot,{preserveThread=true}={}){
 if(snapshot.focus){const element=document.querySelector(snapshot.focus.path);if(element){element.focus({preventScroll:true});if(snapshot.focus.start!=null&&element.setSelectionRange){try{element.setSelectionRange(snapshot.focus.start,snapshot.focus.end);}catch{}}}}
 for(const position of snapshot.positions){const element=document.querySelector(position.path);if(!element||!preserveThread&&element.id==='thread-messages')continue;element.scrollTop=position.top;element.scrollLeft=position.left;if(position.anchor){const row=[...element.querySelectorAll('['+position.anchor.key+']')].find(e=>e.getAttribute(position.anchor.key)===position.anchor.value);if(row)element.scrollTop+=row.getBoundingClientRect().top-element.getBoundingClientRect().top-position.anchor.offset;}}
 window.scrollTo({left:snapshot.x,top:snapshot.y,behavior:'instant'});
}
