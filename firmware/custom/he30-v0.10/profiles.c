/* Four profile slots and shared physical calibration. Each save commits the
 * complete library to the inactive sector, so a reset cannot mix profiles. */
#define LIB_MAGIC 0x39435048u
#define PROFILE_COMMAND 0xd2

static Profile *current_profile(void){return &S->library.profiles[S->library.active];}

__attribute__((section(".extra"),noinline)) static void capture_profile(void){
 Profile *p=current_profile();
 bytes_copy(S->library.calibration,&S->cfg,160);
 bytes_copy(p->keys,S->cfg.key,sizeof(p->keys));
 p->light=S->light;
}

__attribute__((section(".extra"),noinline)) static void activate_profile(void){
 Profile *p=current_profile();
 bytes_copy(&S->cfg,S->library.calibration,160);
 bytes_copy(S->cfg.key,p->keys,sizeof(p->keys));
 S->light=p->light;S->identify=255;S->rgb_pending=3;
 recache();
 S->enabled=typing_requested();
 S->cal_phase=S->staging=0;
 all_released();
}

__attribute__((section(".extra"),noinline)) static void profiles_defaults(void){
 bytes_zero(&S->library,sizeof(Library));
 S->library.rate=3;
 for(u32 i=0;i<PROFILE_COUNT;i++){
  Profile *p=&S->library.profiles[i];
  bytes_copy(p->keys,S->cfg.key,sizeof(p->keys));
  p->light=S->light;
  bytes_copy(p->label,"Profile 1",10);
  p->label[8]='1'+i;
  for(u32 j=0;j<N;j++){p->fn2[j]=0xfe;p->travel[j]=4000;}
 }
 capture_profile();
}

__attribute__((section(".extra"),noinline)) static int action_valid(const Action *a){
 if(a->kind>9||a->key>=N)return 0;
 if(!a->kind)return 1;
 if(a->kind<=2)return a->other<N&&a->key!=a->other&&a->mode<=3&&a->depth[0]<=1000;
 if(a->depth[0]>1000||a->depth[1]>1000)return 0;
 for(u32 j=0;j<4;j++)if(!usage_ok(a->usage[j],0)||a->usage[j]>=0xfd)return 0;
 if(a->kind==3||a->kind==8){
  if(!a->depth[0]||a->depth[0]>=a->depth[1])return 0;
  if(a->kind==8&&a->usage[2]&&(a->depth[2]<=a->depth[1]||a->depth[2]>1000))return 0;
 }
 return 1;
}

__attribute__((section(".extra"),noinline)) static u32 library_crc(const Library *p){
 u32 crc=crc_update(~0u,&p->version,8);
 return ~crc_update(crc,&p->active,4+160+sizeof(p->profiles));
}

__attribute__((section(".extra"),noinline)) static int library_valid(const Library *p){
 return p->magic==LIB_MAGIC&&p->version==3&&p->commit==COMMIT&&
        p->active<PROFILE_COUNT&&p->rate<=6&&p->fast<=2&&p->gamepad<=1&&p->crc==library_crc(p);
}

static const Library *newest_library(void){
 const Library *a=(const Library *)PAGE_A,*b=(const Library *)PAGE_B;
 if(!library_valid(a))return library_valid(b)?b:0;
 if(!library_valid(b))return a;
 return (i32)(b->sequence-a->sequence)>0?b:a;
}

__attribute__((section(".extra"),noinline)) int load_saved(void){
 const Library *p=newest_library();
 if(p){
  bytes_copy(&S->library,p,sizeof(*p));S->saved_seq=p->sequence;
 }else{
  const Record *old=newest_record();
  if(!old)return FLASH;
  S->cfg=old->config;
  if(old->version==2)S->light=old->light;
  profiles_defaults();
  S->saved_seq=old->sequence;
 }
 S->saved_valid=1;S->dirty=0;
 activate_profile();
 return OK;
}

__attribute__((section(".extra"),noinline)) int save_settings(void){
 if(S->cal_phase)return STATE;
 if(!S->dirty&&S->saved_valid)return OK;
 if(!config_valid(&S->cfg)||!lighting_valid(&S->light))return RANGE;
 all_released();
 u32 start=ticks();
 while(usb_ready()&&S->release_pending){
  keyboard_service();
  if(ticks()-start>100*TICKS_MS)return STATE;
 }
 const Library *best=newest_library();
 u32 page=(u32)best;
 if(!page)page=(u32)newest_record()&~4095u;
 u32 target=page==PAGE_A?PAGE_B:PAGE_A;
 capture_profile();
 Library *p=&S->library;
 p->magic=LIB_MAGIC;p->version=3;p->sequence=S->saved_seq+1;p->commit=COMMIT;
 for(u32 i=0;i<sizeof(p->padding);i++)p->padding[i]=255;
 p->crc=library_crc(p);
 u32 result=((u32(*)(u32,const u8*,u32))__ramcode_start)(target,(const u8 *)p,1);
 if(!result&&!library_valid((const Library*)target))result=FLASH;
 S->store_status=result?2:1;
 if(!result){S->saved_seq=p->sequence;S->saved_valid=1;S->dirty=0;}
 return result;
}

__attribute__((section(".extra"),noinline)) static int profile_request(const u8 *request){
 const u8 op=request[2],n=request[4],*data=request+8;
 const u16 off=get16(request+5);
 Profile *p=current_profile();
 int error=OK,changed=0;
 if(op==0){
  u8 status[88]={0};
  put32(status,0x31503348);
  status[4]=1;status[5]=S->library.active;status[6]=S->library.rate;status[7]=S->library.fast;
  status[8]=S->library.gamepad;status[9]=S->usb_rate;status[10]=MM8(0x20000104)==3;status[11]=ACTION_COUNT;
  put16(status+12,S->scan_hz);status[14]=S->running_fast;put32(status+16,S->scan_ticks);put32(status+20,S->scan_worst);
  for(u32 i=0;i<4;i++)bytes_copy(status+24+16*i,S->library.profiles[i].label,16);
  if(off+n<=sizeof(status)){make_reply(PROFILE_COMMAND,OK,off,n,status+off);return OK;}
  error=RANGE;
 }else if(op==1){
  if(off+n<=sizeof(*p)){capture_profile();make_reply(PROFILE_COMMAND,OK,off,n,(const u8*)p+off);return OK;}
  error=RANGE;
 }else if(S->cal_phase)error=STATE;
 else if(op==2&&off==0&&n==1&&data[0]<4){
  capture_profile();S->library.active=data[0];activate_profile();changed=1;
 }else if(op==3&&off==0&&n==16){
  if(data[15])error=RANGE;
  for(u32 i=0;i<15;i++)if(data[i]&&(data[i]<32||data[i]>126))error=RANGE;
  if(!error){bytes_copy(p->label,data,16);changed=1;}
 }else if(op==4&&off<N&&n==1&&usage_ok(data[0],1)){
  p->fn2[off]=data[0];changed=1;
 }else if(op==5&&off<ACTION_COUNT&&n==sizeof(Action)){
  Action a;bytes_copy(&a,data,sizeof(a));
  if(!action_valid(&a))error=RANGE;
  else{p->actions[off]=a;changed=1;}
 }else if(op==6&&off<N&&n==4&&get16(data)>=500&&get16(data)<=6000){
  p->travel[off]=get16(data);p->coefficient[off]=get16(data+2);recache();changed=1;
 }else if(op==7&&off<N&&n==1&&data[0]<=26){
  p->gamepad[off]=data[0];changed=1;
 }else if(op==8&&off==0&&n==3&&data[0]<=6&&data[1]<=2&&data[2]<=1){
  S->library.rate=data[0];S->library.fast=data[1];S->library.gamepad=data[2];changed=1;
 }else error=RANGE;
 if(changed){S->dirty=1;all_released();}
 make_reply(PROFILE_COMMAND,error,0,0,0);
 return error;
}

/*
 * Evaluate the AE64-style coefficient curve when settings change.
 * The hot path interpolates a per-key 33-point cache. C=0 is linear.
 * Zuoya fits and the AE64 catalog are supplied by the driver.
 */
static u32 root32(u32 value){
 u32 root=0,bit=1u<<28;
 while(bit){
  if(value>=root+bit){value-=root+bit;root=(root>>1)+bit;}
  else root>>=1;
  bit>>=2;
 }
 return root;
}

static void recache(void){
 const Profile *p=current_profile();
 for(u32 i=0;i<N;i++){
  const u32 span=abs32((i32)S->cfg.end[i]-S->cfg.rest[i]);
  S->gain[i]=span?(1000u<<16)/span:0;
  S->deadzone_gain[i]=(1000u<<16)/(1000u-10u*(S->cfg.key[i].top+S->cfg.key[i].bottom));
  const u32 c=p->coefficient[i];
  if(!c)continue;
  const u32 max=16384-root32(((c<<16)/(c+65535u))<<12);
  for(u32 j=0;j<33;j++){
   const u32 y=root32(((c<<16)/(c+(65535u*j)/32u))<<12);
   S->curve[i][j]=(1000u*(16384-y)+max/2)/max;
  }
 }
}

__attribute__((section(".extra"),noinline))
static u16 corrected_position(u32 key,u16 input){
 if(!current_profile()->coefficient[key]||input>=1000)return input;
 const u32 scaled=(u32)input*32;
 const u32 segment=scaled/1000;
 const u16 *table=S->curve[key];
 return table[segment]+(table[segment+1]-table[segment])*(scaled%1000)/1000;
}
