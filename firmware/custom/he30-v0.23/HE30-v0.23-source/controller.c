/* Controller tuning is shared, as on AE64 Pro. Physical assignments belong
 * to each of the four HE30 profiles. Reading D3 merges the active assignments.
 */
__attribute__((section(".early"),noinline)) static void gp_profile_bindings(void){
 Profile *profile=current_profile();
 for(u32 i=0;i<10;i++)G->config.analog[i].key=GP_NONE;
 for(u32 i=0;i<14;i++)G->config.digital[i].key=GP_NONE;
 for(u32 i=0;i<N;i++){
  const u8 binding=profile->gamepad[i];
  if(!binding||binding>24)continue;
  u8 *key=binding<=10?&G->config.analog[binding-1].key:&G->config.digital[binding-11].key;
  if(*key==GP_NONE)*key=i;
  else profile->gamepad[i]=0;
 }
 G->config_crc=crc32(&G->config,GP_CONFIG_BYTES);
 gp_reset(&G->state);
 S->gp_pending=1;
}

static int gp_keyboard_only(u32 key){
 return MM8(0x20000104)==3&&G->config.mode==GP_CONTROLLER_ONLY&&
        current_profile()->gamepad[key]>0&&current_profile()->gamepad[key]<=24;
}

static void gp_queue_usb(void){
 if(G->usb_switch!=3)G->usb_switch=S->library.gamepad!=(MM8(0x20000104)==3);
}

__attribute__((used,noinline)) static void gp_usb_service(void){
 if(!G->usb_switch||S->vendor_pending)return;
 const u32 now=ticks();
 if(G->usb_switch==1){G->usb_deadline=now+100*TICKS_MS;G->usb_switch=2;return;}
 if((i32)(now-G->usb_deadline)<0)return;
 if(G->usb_switch==2){
  all_released();keyboard_service();
  ((void(*)(u32))0x5412)(0);
  G->usb_deadline=now+250*TICKS_MS;G->usb_switch=3;
  S->was_usb=S->have_last=0;
 }else{
  usb_gamepad_setup(S->library.gamepad);
  MM8(0x20000269)=0;MM8(0x20000266)=0;MM8(0x20000273)=0;
  ((void(*)(u32))0x5412)(1);
  G->usb_switch=0;
  all_released();
 }
}

__attribute__((section(".early"),noinline)) static void gamepad_request(const u8 *request){
 const u8 op=request[2],count=request[4],*data=request+8;
 const u16 offset=get16(request+5);
 u8 error=OK;
 if(op==0){
  u8 status[40]={0};
  put32(status,0x31473348);status[4]=1;
  status[5]=S->library.gamepad;status[6]=MM8(0x20000104)==3;status[7]=G->config.mode;
  put16(status+8,GP_CONFIG_BYTES);status[10]=N;status[11]=24;
  status[12]=G->state.has_frame&&!G->state.needs_release;status[13]=G->usb_switch;
  put16(status+14,G->state.digital_latches);gp_encode(&G->state.report,status+16);
  put32(status+36,G->config_crc);
  if(offset+count>sizeof(status))error=RANGE;
  else{make_reply(0xd3,OK,offset,count,status+offset);return;}
 }else if(op==1){
  if(offset+count>GP_CONFIG_BYTES)error=RANGE;
  else{make_reply(0xd3,OK,offset,count,(const u8*)&G->config+offset);return;}
 }else if(S->cal_phase)error=STATE;
 else if(op==2){
  if(!count||offset+count>GP_CONFIG_BYTES)error=RANGE;
  else if(offset&&!G->staging)error=STAGING;
  else{
   if(!offset){G->staging=1;bytes_zero(G->coverage,sizeof(G->coverage));}
   bytes_copy((u8*)&G->staged+offset,data,count);
   for(u32 i=offset;i<offset+count;i++)G->coverage[i>>3]|=1u<<(i&7);
  }
 }else if(op==3){
  if(offset||count!=4)error=PACKET;
  else if(!G->staging)error=STAGING;
  else{
   for(u32 i=0;i<GP_CONFIG_BYTES;i++)if(!(G->coverage[i>>3]&(1u<<(i&7))))error=STAGING;
   if(!error&&crc32(&G->staged,GP_CONFIG_BYTES)!=get32(data))error=CRC;
   if(!error&&!gp_valid(&G->staged))error=RANGE;
   if(!error){
    G->config=G->staged;G->staging=0;
    Profile *profile=current_profile();bytes_zero(profile->gamepad,N);
    for(u32 i=0;i<24;i++){
     u8 key=i<10?G->config.analog[i].key:G->config.digital[i-10].key;
     if(key!=GP_NONE)profile->gamepad[key]=i+1;
    }
    G->config_crc=get32(data);S->dirty=1;all_released();
   }
  }
 }else if(op==4&&offset==0&&count==1&&data[0]<=1){
  if(S->library.gamepad!=data[0]){S->library.gamepad=data[0];S->dirty=1;}
  all_released();gp_queue_usb();
 }else error=RANGE;
 make_reply(0xd3,error,0,0,0);
}
