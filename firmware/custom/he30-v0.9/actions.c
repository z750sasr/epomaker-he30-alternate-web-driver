/* Physical states feed the rule engine; keyboard output is composed from
 * surviving sources each frame, so suppressing one source cannot strand a key. */
__attribute__((section(".early"),noinline)) static void release_actions(void){
 bytes_zero(S->action_prev,ACTION_COUNT);
 bytes_zero(S->action_state,ACTION_COUNT);
 bytes_zero(S->winner,ACTION_COUNT);
 bytes_zero(S->action_queue,ACTION_COUNT);
 S->gp_pending=1;
}

__attribute__((section(".early"),noinline)) static void filter_pair(const Action *a,u32 slot){
 const u32 left=a->key,right=a->other;
 const u8 both=S->active[left] | (S->active[right]<<1);
 const u8 new_edges=both&~S->action_prev[slot];
 u8 choice=S->winner[slot];
 S->action_prev[slot]=both;
 if(both<3){S->winner[slot]=both;return;}
 if(a->kind==2){
  if(S->pos[left]==1000&&S->pos[right]==1000)return;
  i32 delta=(i32)S->pos[left]-S->pos[right];
  if(delta>(i32)a->depth[0])choice=1;
  else if(delta<-(i32)a->depth[0])choice=2;
  else if(!a->mode)choice=0;
 }else if(a->mode==0)choice=0;
 else if(a->mode<3)choice=a->mode;
 else if(new_edges)choice=new_edges==3?0:new_edges;
 S->winner[slot]=choice;
 if(choice!=1)S->overflow[left]=1;
 if(choice!=2)S->overflow[right]=1;
}

__attribute__((section(".early"),noinline)) static void run_action(const Action *a,u32 slot,u32 now){
 const u8 down=S->active[a->key], old=S->action_prev[slot];
 const u8 rising=down&&!old, falling=!down&&old;
 u8 state=S->action_state[slot];
 u32 period=(a->depth[0]?a->depth[0]:180)*TICKS_MS;
 u32 age=now-S->action_time[slot];
 S->action_prev[slot]=down;
 if(a->kind==3){
  /* DKS emits phase-specific actions at shallow/deep down and deep/shallow up. */
  const u16 depth=S->pos[a->key];
  u8 stage=depth>=a->depth[1]?2:depth>=a->depth[0]?1:0;
  S->action_prev[slot]=stage;
  u8 queued=S->action_queue[slot];
  if(old<1&&stage>=1)queued|=1;
  if(old<2&&stage>=2)queued|=2;
  if(old>=2&&stage<2)queued|=4;
  if(old>=1&&stage<1)queued|=8;
  if(state&&age>=12*TICKS_MS){state=0;S->action_time[slot]=now;age=0;}
  if(!state&&queued&&age>=9*TICKS_MS){
   u32 index=0;while(!(queued&(1u<<index)))index++;
   queued&=~(1u<<index);state=1+index;S->action_time[slot]=now;
  }
  S->action_queue[slot]=queued;
  if(state)add_usage(a->usage[state-1]);
 }else if(a->kind==4){
  if(rising){state=1;S->action_time[slot]=now;age=0;}
  if(state==1&&down&&age>=period)state=2;
  if(falling){
   state=state==1&&age<period?3:0;
   S->action_time[slot]=now;age=0;
  }
  if(state==2&&down)add_usage(a->usage[1]);
  if(state==3){if(age<12*TICKS_MS)add_usage(a->usage[0]);else state=0;}
 }else if(a->kind==5){
  if(rising)state^=1;
  if(state)add_usage(a->usage[0]);
 }else if(a->kind==6){
  if(down)for(u32 i=0;i<4;i++)add_usage(a->usage[i]);
 }else if(a->kind==7){
  /* Four timed key taps with a release gap between taps. */
  if(rising){state=1;age=0;S->action_time[slot]=now;}
  const u32 step=(a->depth[0]>=16?a->depth[0]:24)*TICKS_MS;
  if(state){
   u32 part=age/step;
   if(part>=8)state=0;
   else if(!(part&1))add_usage(a->usage[part>>1]);
  }
 }else if(a->kind==8){
  if(S->pos[a->key]>=a->depth[0])add_usage(a->usage[0]);
  if(S->pos[a->key]>=a->depth[1])add_usage(a->usage[1]);
  if(a->usage[2]&&S->pos[a->key]>=a->depth[2])add_usage(a->usage[2]);
 }else if(a->kind==9){
  if(rising)state=1;
  if(falling&&state){state=2;S->action_time[slot]=now;age=0;}
  if(down)add_usage(a->usage[0]);
  if(state==2&&age>=a->depth[0]*TICKS_MS){
   if(age<(a->depth[0]+12u)*TICKS_MS)add_usage(a->usage[1]);else state=0;
  }
 }
 S->action_state[slot]=state;
}

__attribute__((section(".early"),noinline)) static void compose_advanced(void){
 Profile *p=current_profile();
 bytes_zero(S->overflow,N);
 for(u32 i=0;i<ACTION_COUNT;i++){
  const Action *a=&p->actions[i];
  if(a->kind&&a->kind<=2)filter_pair(a,i);
 }
 u32 now=ticks();
 for(u32 i=0;i<ACTION_COUNT;i++){
  const Action *a=&p->actions[i];
  if(a->kind<=2)continue;
  const int controller_only=p->gamepad[a->key]&&MM8(0x20000104)==3;
  if(!controller_only&&!S->overflow[a->key]&&!(S->cfg.key[a->key].flags&2))run_action(a,i,now);
  else S->action_state[i]=S->action_prev[i]=S->action_queue[i]=0;
  S->overflow[a->key]=1;
 }
 for(u32 i=0;i<N;i++)if(S->active[i]&&!S->overflow[i]&&!(p->gamepad[i]&&MM8(0x20000104)==3))
  add_usage(S->latched[i]);
}

__attribute__((section(".early"),noinline)) static void gpio_poll_setup(void){
 /* The descriptor starts with two HID interfaces. Enable EP3's separate
  * generic gamepad interface only when requested in the saved library. */
 const u8 enabled=S->library.gamepad;
 MM8(0x20000102)=enabled?91:66;
 MM8(0x20000104)=enabled?3:2;
 S->usb_rate=6-S->library.rate;
}

__attribute__((section(".extra"),noinline)) static void gp_service(void){
 if(MM8(0x20000104)!=3)return;
 if(!usb_ready()){S->gp_pending=1;return;}
 u8 report[12]={0};
 if(S->enabled&&!S->inhibit&&!S->gp_pending&&!S->scan_error){
  i32 dir[10]={0};
  const Profile *p=current_profile();
  for(u32 i=0;i<N;i++){
   u8 binding=p->gamepad[i];
   if(!binding||(S->cfg.key[i].flags&2))continue;
   if(binding<=10){
    i32 amount=S->pos[i];
    if(amount>dir[binding-1])dir[binding-1]=amount;
   }else if(S->active[i])report[(binding-11)>>3]|=1u<<((binding-11)&7);
  }
  for(u32 i=0;i<4;i++)put16(report+2+2*i,(dir[2*i+1]-dir[2*i])*32767/1000);
  for(u32 i=0;i<2;i++)report[10+i]=dir[8+i]*255/1000;
 }
 u32 now=ticks();
 if(S->gp_pending||(now-S->gp_ticks>=((TICKS_MS/8)<<S->usb_rate)&&!equal(report,S->gp_last,12))){
  if(upload(3,report,12,1)){S->gp_pending=0;S->gp_ticks=now;bytes_copy(S->gp_last,report,12);}
 }
}
