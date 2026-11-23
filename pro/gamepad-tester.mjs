const standardButtons=['A','B','X','Y','LB','RB','LT','RT','Back','Start','LS','RS','↑','↓','←','→','Home'];
const standardAxes=['Left X','Left Y','Right X','Right Y'];

export function startGamepadTester(panel){
  if(!panel)return;
  const status=panel.querySelector('[role=status]');
  const devices=panel.querySelector('.tester-signals');
  const idle='Press a mapped controller button or move a stick to show input.';
  let previous='';

  function paint(){
    if(!panel.isConnected)return;
    let pads;
    try{pads=Array.from(navigator.getGamepads()).filter(pad=>pad?.connected);}
    catch{status.textContent='The browser does not expose controller input on this page.';return;}
    const values=pads.map(pad=>({id:pad.id, standard:pad.mapping==='standard',
      axes:pad.axes.map(axis=>axis.toFixed(2)), buttons:pad.buttons.map(button=>[button.pressed,button.value.toFixed(2)])}));
    const signature=JSON.stringify(values);
    if(previous!==signature){
      previous=signature;
      status.textContent=values.length?'Controller input received by the browser.':idle;
      devices.replaceChildren(...values.map(pad=>{
        const section=document.createElement('section');
        section.className='tester-device';
        const title=document.createElement('h3');
        title.textContent=pad.id||'Gamepad';
        const axes=document.createElement('div'),buttons=document.createElement('div');
        axes.className='tester-axes';buttons.className='tester-buttons';
        axes.innerHTML=pad.axes.map((value,i)=>`<label>${pad.standard&&standardAxes[i]||'Axis '+(i+1)}<meter min="-1" max="1" value="${value}"></meter><span>${value}</span></label>`).join('');
        buttons.innerHTML=pad.buttons.map(([pressed,value],i)=>`<span class="${pressed?'pressed':''}">${pad.standard&&standardButtons[i]||'B'+(i+1)} <small>${value}</small></span>`).join('');
        section.append(title,axes,buttons);
        return section;
      }));
    }
    requestAnimationFrame(paint);
  }
  requestAnimationFrame(paint);
}
