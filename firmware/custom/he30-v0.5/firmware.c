/* HE30 foundation: owner-traced matrix, explicit calibration, reliable HID.
 * Native USB/reset/clock machinery is retained from the working v0.3 donor.
 * No stock Hall/settings/RGB code is called. All new application code is RV32IM.
 */
typedef unsigned char u8; typedef unsigned short u16; typedef unsigned int u32;
typedef signed int i32;
#define MM8(a) (*(volatile u8 *)(a))
#define MM16(a) (*(volatile u16 *)(a))
#define MM32(a) (*(volatile u32 *)(a))
#define N 36
#define ALL_LO 0xffffffffu
#define ALL_HI 15u
#define CFG_SIZE 664
#define STATE_ADDR 0x20004000u
#define RX ((volatile u8 *)0x20000b7c)
#define TICKS_MS 144000u
#define BANK_OK 1u
#define START_TYPING 2u
#define PAGE_A 0x0801e000u
#define PAGE_B 0x0801f000u
#define RECORD_MAGIC 0x35434648u
#define COMMIT 0x5ac3d17eu
enum { OK, PACKET, RANGE, STATE, CRC, STAGING, BANK, CALIBRATION, RELEASE, FLASH, ADC };
typedef struct __attribute__((packed)) {u16 act,hys,rt_press,rt_release;u8 normal,fn,flags,top,bottom,reserved;} Key;
typedef struct __attribute__((packed)) {u8 version,groups[3];u16 settle,flags;u32 valid_lo,valid_hi;u16 rest[N],end[N];Key key[N];} Config;
typedef struct {u32 magic,version,sequence,crc;Config config;u8 padding[1024-16-CFG_SIZE-4];u32 commit;} Record;
_Static_assert(sizeof(Key)==14&&sizeof(Config)==CFG_SIZE&&sizeof(Record)==1024,"wire layout");
typedef struct {
 u8 legacy[64];Config cfg,staged;u8 coverage[(CFG_SIZE+7)/8],staging;
 u16 raw[N],filtered[N],pos[N],cal_rest[N],cal_end[N],noise_min[N],noise_max[N];u32 sums[N];
 u8 active[N],latched[N],rt_state[N],debounce[N];u16 peak[N],trough[N];
 u8 enabled,cal_phase,rest_count,scan_error,dirty,inhibit,quiet,first_frame;
 u8 release_pending,have_last,was_usb,fn,rollover,saved_valid,store_status,vendor_pending;
 u8 report[8],last[8],vendor[64];u32 frames,saved_seq,accepted,last_ticks;
 u32 cal_lo,cal_hi;u8 scratch[1024];
} App;
#define S ((App *)STATE_ADDR)
_Static_assert(sizeof(App)<0x2c00,"state/stack reservations");
/* Retained offsets let the instruction verifier inspect the compiler's actual
 * SRAM layout rather than assuming host struct alignment. */
#define OFF(member) __builtin_offsetof(App,member)
__attribute__((used,section(".layout"))) const u32 verification_layout[]={
 sizeof(App),OFF(cfg),OFF(staged),OFF(coverage),OFF(staging),OFF(raw),OFF(filtered),OFF(pos),
 OFF(cal_rest),OFF(cal_end),OFF(noise_min),OFF(noise_max),OFF(sums),OFF(active),OFF(latched),
 OFF(rt_state),OFF(debounce),OFF(peak),OFF(trough),OFF(enabled),OFF(cal_phase),OFF(rest_count),
 OFF(scan_error),OFF(dirty),OFF(inhibit),OFF(quiet),OFF(first_frame),OFF(release_pending),
 OFF(have_last),OFF(was_usb),OFF(fn),OFF(rollover),OFF(saved_valid),OFF(store_status),
 OFF(vendor_pending),OFF(report),OFF(last),OFF(vendor),OFF(frames),OFF(saved_seq),
 OFF(accepted),OFF(last_ticks),OFF(cal_lo),OFF(cal_hi),OFF(scratch)
};
typedef u8 (*Upload)(u8,const u8 *,u16,u8);
#define upload ((Upload)0x5506)
#define native_void(a) ((void (*)(void))(a))()
extern u8 __ramcode_start[],__ramcode_end[],__ramcode_load[];
static const u8 channels[12]={6,7,14,15,8,9,5,4,12,13,11,10};
static const u8 normal[N]={0x3a,0x3b,0x3c,0x3d,0x3e,0x3f,0x35,0x2c,0xff,0xe2,0xe0,5,0x23,0x2b,0x14,0x1a,8,0x15,0x22,0x21,0x1f,0x20,0x1e,0x29,0x0a,0xe1,0x1d,0x1b,6,0x19,9,7,4,0x16,0x39,0x17};
static void bytes_zero(void *p,u32 n){u8*d=p;while(n--)*d++=0;}
static void bytes_copy(void *d,const void *p,u32 n){u8*a=d;const u8*b=p;while(n--)*a++=*b++;}
void *memset(void *p,int c,u32 n){volatile u8*d=p;while(n--)*d++=(u8)c;return p;}
void *memcpy(void *d,const void *p,u32 n){bytes_copy(d,p,n);return d;}
static int equal(const void*a,const void*b,u32 n){const u8*x=a,*y=b;while(n--)if(*x++!=*y++)return 0;return 1;}
static u32 abs32(i32 x){return x<0?(u32)-x:(u32)x;}
static u32 ticks(void){return MM32(0xe000f008u);}
static void time_init(void){MM32(0xe000f000)=0;MM32(0xe000f004)=0;MM32(0xe000f008)=0;MM32(0xe000f00c)=0;MM32(0xe000f010)=~0u;MM32(0xe000f014)=~0u;MM32(0xe000f000)=5;}
static void delay(u32 n){__asm__ volatile("1: addi %0,%0,-1\n bnez %0,1b":"+r"(n)::"memory");}
u32 crc32(const void *p,u32 n){const u8*b=p;u32 c=~0u;while(n--){c^=*b++;for(u32 j=0;j<8;j++)c=(c>>1)^(0xedb88320u&-(c&1));}return~c;}
static int bit(u32 lo,u32 hi,u32 i){return i<32?((lo>>i)&1):((hi>>(i-32))&1);}
static void set_bit(u32 *lo,u32 *hi,u32 i){if(i<32)*lo|=1u<<i;else*hi|=1u<<(i-32);}
static int calibrated(void){return S->cfg.valid_lo==ALL_LO&&S->cfg.valid_hi==ALL_HI;}
static int usb_ready(void){return MM8(0x20000269)&&MM8(0x20000266)&&!(MM8(0x20000268)&2);}
static void put16(u8*p,u16 v){p[0]=v;p[1]=v>>8;}
static void put32(u8*p,u32 v){for(u32 i=0;i<4;i++)p[i]=v>>(8*i);}
static u16 get16(const u8*p){return p[0]|(u16)p[1]<<8;}
static u32 get32(const u8*p){return p[0]|(u32)p[1]<<8|(u32)p[2]<<16|(u32)p[3]<<24;}
static void all_released(void){bytes_zero(S->active,N);bytes_zero(S->latched,N);bytes_zero(S->rt_state,N);bytes_zero(S->debounce,N);bytes_zero(S->report,8);S->fn=0;S->rollover=0;S->release_pending=1;S->inhibit=1;S->quiet=0;}
void config_defaults(Config*c){
 bytes_zero(c,sizeof(*c));c->version=1;c->groups[0]=2;c->groups[1]=0;c->groups[2]=1;c->settle=16000;c->flags=BANK_OK;
 for(u32 i=0;i<N;i++){Key*k=&c->key[i];k->act=500;k->hys=50;k->rt_press=k->rt_release=40;k->normal=normal[i];k->fn=0xfe;}
 for(u32 i=0;i<6;i++)c->key[i].fn=0x40+i;
 for(u32 i=0;i<N;i++)if(normal[i]>=0x1e&&normal[i]<=0x23)c->key[i].fn=0x3a+(normal[i]-0x1e);
}
static int usage_ok(u8 u,int fn){return u==0||(u>=4&&u<=0xa4)||(u>=0xe0&&u<=0xe7)||u==0xff||(fn&&u==0xfe);}
int config_valid(const Config*c){
 if(c->version!=1||c->groups[0]>2||c->groups[1]>2||c->groups[2]>2||c->groups[0]==c->groups[1]||c->groups[0]==c->groups[2]||c->groups[1]==c->groups[2]||c->settle<100||c->settle>32000||(c->flags&~3)||c->valid_hi>15)return 0;
 for(u32 i=0;i<N;i++){const Key*k=&c->key[i];if(c->rest[i]>4095||c->end[i]>4095||(bit(c->valid_lo,c->valid_hi,i)&&abs32((i32)c->end[i]-c->rest[i])<64)||k->act<10||k->act>990||!k->hys||k->hys>500||k->rt_press<5||k->rt_press>1000||k->rt_release<5||k->rt_release>1000||k->flags>3||k->top>40||k->bottom>40||k->reserved||!usage_ok(k->normal,0)||!usage_ok(k->fn,1))return 0;}
 return 1;
}
static u16 position(u32 i,u16 raw,int learning){
 i32 rest=learning?S->cal_rest[i]:S->cfg.rest[i],end=learning?S->cal_end[i]:S->cfg.end[i],span=end-rest;
 if(abs32(span)<64)return 0;
 i32 p=((i32)raw-rest)*1000/span;
 i32 top=S->cfg.key[i].top*10,bottom=S->cfg.key[i].bottom*10;
 p=(p-top)*1000/(1000-top-bottom);if(p<0)p=0;if(p>1000)p=1000;return p;
}
static int released_now(int learning){for(u32 i=0;i<N;i++){i32 rest=learning?S->cal_rest[i]:S->cfg.rest[i],end=learning?S->cal_end[i]:S->cfg.end[i];u32 tolerance=abs32(end-rest)/8;if(tolerance<16)tolerance=16;if(abs32((i32)S->raw[i]-rest)>tolerance)return 0;}return 1;}
void compose_report(void){
 bytes_zero(S->report,8);u32 count=0;S->rollover=0;
 for(u32 i=0;i<N;i++)if(S->active[i]){u8 u=S->latched[i];if(u>=0xe0&&u<=0xe7){S->report[0]|=1u<<(u-0xe0);continue;}if(!u||u>=0xfe)continue;
  int duplicate=0;for(u32 j=0;j<count&&j<6;j++)if(S->report[2+j]==u)duplicate=1;
  if(!duplicate){if(count<6)S->report[2+count]=u;count++;}
 }
 if(count>6){S->rollover=1;for(u32 j=2;j<8;j++)S->report[j]=1;}
}
void engine_step(const u16 *input){
 S->frames++;u8 previous[N];bytes_copy(previous,S->active,N);
 for(u32 i=0;i<N;i++){S->raw[i]=input[i];S->filtered[i]=S->first_frame?(S->filtered[i]+input[i]+1)/2:input[i];}S->first_frame=1;
 if(S->cal_phase==1){
  for(u32 i=0;i<N;i++){S->sums[i]+=input[i];if(input[i]<S->noise_min[i])S->noise_min[i]=input[i];if(input[i]>S->noise_max[i])S->noise_max[i]=input[i];}
  if(++S->rest_count==32){for(u32 i=0;i<N;i++)S->cal_rest[i]=S->cal_end[i]=S->sums[i]/32;S->cal_phase=2;}
 }
 if(S->cal_phase==2){S->cal_lo=S->cal_hi=0;for(u32 i=0;i<N;i++){if(abs32((i32)input[i]-S->cal_rest[i])>abs32((i32)S->cal_end[i]-S->cal_rest[i]))S->cal_end[i]=input[i];u32 minimum=(S->noise_max[i]-S->noise_min[i])*6;if(minimum<64)minimum=64;if(abs32((i32)S->cal_end[i]-S->cal_rest[i])>=minimum)set_bit(&S->cal_lo,&S->cal_hi,i);}}
 for(u32 i=0;i<N;i++)S->pos[i]=position(i,S->filtered[i],S->cal_phase!=0);
 if(S->inhibit){int quiet=1;for(u32 i=0;i<N;i++)if(S->pos[i]>50)quiet=0;if(quiet){if(S->quiet<8)S->quiet++;if(S->quiet==8&&!S->release_pending)S->inhibit=0;}else S->quiet=0;}
 if(!S->enabled||S->cal_phase||S->scan_error||S->inhibit){bytes_zero(S->active,N);bytes_zero(S->latched,N);bytes_zero(S->report,8);S->fn=0;S->rollover=0;return;}
 for(u32 i=0;i<N;i++){
  Key*k=&S->cfg.key[i];u16 p=S->pos[i];int target=S->active[i];
  if(k->flags&2){S->active[i]=S->latched[i]=S->rt_state[i]=S->debounce[i]=0;continue;}
  if(!(k->flags&1)){u16 release=k->act>k->hys?k->act-k->hys:0;target=S->active[i]?p>release:p>=k->act;}
  else if(S->active[i]){if(p>S->peak[i])S->peak[i]=p;target=p>0&&S->peak[i]-p<k->rt_release;}
  else {if(!p)S->rt_state[i]=0;if(S->rt_state[i]==2){if(p<S->trough[i])S->trough[i]=p;target=p>0&&p-S->trough[i]>=k->rt_press;}else target=p>=k->act;}
  if(target!=S->active[i]){if(++S->debounce[i]>=2){S->active[i]=target;S->debounce[i]=0;if(target){S->peak[i]=p;S->rt_state[i]=1;}else{S->trough[i]=p;S->rt_state[i]=p?2:0;S->latched[i]=0;}}}else S->debounce[i]=0;
 }
 S->fn=0;for(u32 i=0;i<N;i++)if(S->active[i]&&S->cfg.key[i].normal==0xff)S->fn=1;
 for(u32 i=0;i<N;i++)if(S->active[i]&&!previous[i]){u8 u=S->fn?S->cfg.key[i].fn:S->cfg.key[i].normal;if(u==0xfe)u=S->cfg.key[i].normal;S->latched[i]=u;}
 compose_report();
}
void keyboard_service(void){
 int ready=usb_ready();if(!ready){if(S->was_usb)all_released();S->was_usb=0;S->have_last=0;return;}
 if(!S->was_usb){all_released();S->was_usb=1;S->have_last=0;}
 u8 zero[8]={0};const u8*r=S->release_pending?zero:S->report;
 u32 elapsed=ticks()-S->last_ticks, idle=MM8(0x2000026c);
 if(S->release_pending||!S->have_last||!equal(r,S->last,8)||(idle&&elapsed>=idle*4*TICKS_MS)){
  if(upload(1,r,8,1)==1){bytes_copy(S->last,r,8);S->have_last=1;S->last_ticks=ticks();S->accepted++;if(S->release_pending)S->release_pending=0;}
 }
}
static void banks_off(void){MM32(0x40011010)=0x6000;MM32(0x40010c10)=0x400;}
static u8 adc_init(void){
 MM32(0x40021018)|=0x21c;MM32(0x40021004)=(MM32(0x40021004)&~0xc000u)|0xc000;
 MM32(0x40010800)&=0xffff;MM32(0x40010c00)&=~0xffu;MM32(0x40011000)&=0xff000000;
 banks_off();MM32(0x40011004)=(MM32(0x40011004)&~0x0ff00000u)|0x02200000;MM32(0x40010c04)=(MM32(0x40010c04)&~0xf00u)|0x200;
 MM32(0x40012404)=0;MM32(0x40012408)=0xe0001;MM32(0x4001240c)=0xffffff;MM32(0x40012410)=0x3fffffff;MM32(0x4001242c)=MM32(0x40012430)=MM32(0x40012434)=0;delay(2000);
 for(u32 mask=8;mask>=4;mask>>=1){MM32(0x40012408)|=mask;u32 timeout=25000;while((MM32(0x40012408)&mask)&&--timeout);if(!timeout){MM32(0x40012408)=0;return mask==8?1:2;}}
 return 0;
}
static u8 adc_frame(u16 *out){
 for(u32 group=0;group<3;group++){
  banks_off();u8 bank=S->cfg.groups[group];if(bank==0)MM32(0x40011014)=0x2000;else if(bank==1)MM32(0x40011014)=0x4000;else MM32(0x40010c14)=0x400;
  delay(S->cfg.settle);
  for(u32 j=0;j<12;j++){MM32(0x40012434)=channels[j];MM32(0x40012400)=0;MM32(0x40012408)|=0x500000;u32 timeout=25000;while(!(MM32(0x40012400)&2)&&--timeout);if(!timeout){banks_off();MM32(0x40012408)=0;return 3;}out[group*12+j]=MM32(0x4001244c)&4095;}
 }banks_off();return 0;
}
static u32 record_crc(const Record*r){u32 c=~0u;const u8 *p=(const u8*)&r->version;u32 n=8;while(n--){c^=*p++;for(u32 j=0;j<8;j++)c=(c>>1)^(0xedb88320u&-(c&1));}p=(const u8*)&r->config;n=sizeof(Config);while(n--){c^=*p++;for(u32 j=0;j<8;j++)c=(c>>1)^(0xedb88320u&-(c&1));}return~c;}
static int record_valid(const Record*r){return r->magic==RECORD_MAGIC&&r->version==1&&r->commit==COMMIT&&r->crc==record_crc(r)&&config_valid(&r->config);}
static const Record* newest_record(void){const Record*best=0;for(u32 i=0;i<8;i++){const Record*r=(const Record*)(PAGE_A+i*1024);if(record_valid(r)&&(!best||(i32)(r->sequence-best->sequence)>0))best=r;}return best;}
int load_saved(void){const Record*r=newest_record();if(!r)return FLASH;bytes_copy(&S->cfg,&r->config,sizeof(Config));S->saved_seq=r->sequence;S->saved_valid=1;S->dirty=0;S->enabled=(S->cfg.flags&3)==3&&calibrated();all_released();return 0;}
/* Fixed-address writer copied to SRAM. Program-controller unlock is not a
 * read-protection/option-byte operation. Never erase the page with newest data.
 */
__attribute__((section(".ramcode"),noinline))
u32 flash_writer(u32 address,const u8*record,u32 erase){
 if(address<PAGE_A||address>PAGE_B+3072||(address&1023)||(u32)record<STATE_ADDR||(u32)record+1024>0x20006c00||erase>1)return FLASH;
 u32 status=0,saved;__asm__ volatile("csrrc %0,mstatus,%1":"=r"(saved):"r"(8):"memory");
 MM32(0x40022004)=0x45670123;MM32(0x40022004)=0xcdef89ab;MM32(0x4002200c)=0x34;
 u32 start=MM32(0xe000f008);while(MM32(0x4002200c)&1){if(MM32(0xe000f008)-start>144000000u){status=FLASH;goto done;}}
 if(erase){MM32(0x40022010)|=2;MM32(0x40022014)=address&~4095u;MM32(0x40022010)|=0x40;
  start=MM32(0xe000f008);while(MM32(0x4002200c)&1){if(MM32(0xe000f008)-start>144000000u){status=FLASH;goto done;}}
  MM32(0x40022010)&=~2u;if(MM32(0x4002200c)&0x14){status=FLASH;goto done;}
 }
 for(u32 i=0;i<1024;i+=2){u16 value=record[i]|(u16)record[i+1]<<8;if(value==0xffff)continue;
  MM32(0x40022010)|=1;MM16(address+i)=value;
  start=MM32(0xe000f008);while(MM32(0x4002200c)&1){if(MM32(0xe000f008)-start>144000000u){status=FLASH;goto done;}}
  MM32(0x40022010)&=~1u;if((MM32(0x4002200c)&0x14)||MM16(address+i)!=value){status=FLASH;goto done;}
 }
done:MM32(0x40022010)=(MM32(0x40022010)&~3u)|0x80;if(saved&8)__asm__ volatile("csrsi mstatus,8":::"memory");return status;
}
int save_settings(void){
 if(S->cal_phase)return STATE;
 if(!config_valid(&S->cfg))return RANGE;
 all_released();u32 release_start=ticks();while(usb_ready()&&S->release_pending){keyboard_service();if(ticks()-release_start>100*TICKS_MS)return STATE;}
 const Record*best=newest_record();u32 active=best?((u32)best&~4095u):PAGE_A,target=0,erase=0;
 for(u32 i=0;i<4;i++){const u32*p=(const u32*)(active+i*1024);int blank=1;for(u32 j=0;j<256;j++)if(p[j]!=~0u){blank=0;break;}if(blank){target=(u32)p;break;}}
 if(!target){target=active==PAGE_A?PAGE_B:PAGE_A;erase=1;}
 Record*r=(Record*)S->scratch;for(u32 i=0;i<1024;i++)S->scratch[i]=255;
 r->magic=RECORD_MAGIC;r->version=1;r->sequence=best?best->sequence+1:1;bytes_copy(&r->config,&S->cfg,sizeof(Config));r->crc=record_crc(r);r->commit=COMMIT;
 u32 status=((u32(*)(u32,const u8*,u32))__ramcode_start)(target,S->scratch,erase);
 if(!status&&!record_valid((const Record*)target))status=FLASH;
 if(!status){S->saved_seq=r->sequence;S->saved_valid=1;S->dirty=0;}S->store_status=status?2:1;return status;
}
static void begin_calibration(void){
 S->enabled=0;all_released();S->cal_phase=1;S->rest_count=0;S->cal_lo=S->cal_hi=0;bytes_zero(S->sums,sizeof(S->sums));for(u32 i=0;i<N;i++){S->noise_min[i]=4095;S->noise_max[i]=0;S->cal_rest[i]=S->cal_end[i]=0;}
}
static int finish_calibration(void){
 if(S->cal_phase!=2)return STATE;if(S->cal_lo!=ALL_LO||S->cal_hi!=ALL_HI)return CALIBRATION;if(!released_now(1))return RELEASE;
 bytes_copy(S->cfg.rest,S->cal_rest,sizeof(S->cal_rest));bytes_copy(S->cfg.end,S->cal_end,sizeof(S->cal_end));S->cfg.valid_lo=ALL_LO;S->cfg.valid_hi=ALL_HI;S->cfg.flags&=~START_TYPING;S->cal_phase=0;S->dirty=1;S->enabled=0;all_released();return OK;
}
static u8 missing(u32 lo,u32 hi){u8 n=0;for(u32 i=0;i<N;i++)if(!bit(lo,hi,i))n++;return n;}
void status_bytes(u8*out){
 bytes_zero(out,208);out[0]='H';out[1]='3';out[2]='K';out[3]='1';out[4]=1;out[5]=S->enabled;out[6]=S->cal_phase;out[7]=S->scan_error;
 put32(out+8,S->frames);put32(out+12,S->saved_seq);u32 lo=S->cal_phase?S->cal_lo:S->cfg.valid_lo,hi=S->cal_phase?S->cal_hi:S->cfg.valid_hi;put32(out+16,lo);put32(out+20,hi);
 bytes_copy(out+24,S->cfg.groups,3);out[27]=S->cfg.flags;out[28]=S->dirty;out[29]=S->store_status;out[30]=S->inhibit;out[31]=usb_ready();
 for(u32 i=0;i<N;i++){put16(out+32+i*2,S->raw[i]);put16(out+104+i*2,S->pos[i]);}
 u32 pressed_lo=0,pressed_hi=0;for(u32 i=0;i<N;i++)if(S->active[i])set_bit(&pressed_lo,&pressed_hi,i);put32(out+176,pressed_lo);put32(out+180,pressed_hi);
 out[184]=S->fn;out[185]=S->rollover;out[186]=S->rest_count;put32(out+188,S->accepted);bytes_copy(out+192,S->report,8);out[200]=missing(lo,hi);out[201]=36;out[202]=S->saved_valid;put32(out+204,crc32(&S->cfg,sizeof(Config)));
}
static void make_reply(u8 cmd,u8 error,u16 offset,u8 count,const u8*data){
 bytes_zero(S->vendor,64);S->vendor[0]=0xaa;S->vendor[1]=cmd;S->vendor[2]=error;
 if(!error){S->vendor[4]=count;put16(S->vendor+5,offset);if(count)bytes_copy(S->vendor+8,data,count);}
 u8 sum=0;for(u32 i=4;i<8u+S->vendor[4];i++)sum+=S->vendor[i];S->vendor[3]=sum;S->vendor_pending=1;
}
int apply_staged(u32 expected){
 if(!S->staging)return STAGING;for(u32 i=0;i<CFG_SIZE;i++)if(!(S->coverage[i>>3]&(1u<<(i&7))))return STAGING;
 if(crc32(&S->staged,CFG_SIZE)!=expected)return CRC;if(!config_valid(&S->staged))return RANGE;
 int banks_changed=!equal(S->cfg.groups,S->staged.groups,3);all_released();bytes_copy(&S->cfg,&S->staged,CFG_SIZE);S->staging=0;S->cal_phase=0;S->dirty=1;
 if(banks_changed){S->cfg.valid_lo=S->cfg.valid_hi=0;S->cfg.flags&=~START_TYPING;}
 S->enabled=(S->cfg.flags&3)==3&&calibrated()&&!S->scan_error;return OK;
}
static int control(u8 op){
 switch(op){
  case 4:if(S->scan_error)return ADC;begin_calibration();return OK;
  case 5:return finish_calibration();
  case 6:if(S->scan_error)return ADC;if(S->cal_phase)return STATE;if(!(S->cfg.flags&BANK_OK))return BANK;if(!calibrated())return CALIBRATION;S->enabled=1;S->cfg.flags|=START_TYPING;S->dirty=1;all_released();return OK;
  case 7:S->enabled=0;S->cfg.flags&=~START_TYPING;S->dirty=1;all_released();return OK;
  case 8:return save_settings();
  case 9:all_released();S->enabled=S->cal_phase=S->staging=0;config_defaults(&S->cfg);S->dirty=1;return OK;
  case 10:all_released();S->scan_error=adc_init();S->first_frame=0;return S->scan_error?ADC:OK;
  case 11:S->cal_phase=0;S->enabled=0;all_released();return OK;
  case 12:S->cal_phase=0;S->enabled=0;all_released();return load_saved();
  default:return RANGE;
 }
}
void vendor_request(const u8*request){
 u8 cmd=request[1],op=request[2],length=request[4];u16 offset=get16(request+5);
 if(request[0]!=0x55){make_reply(cmd,PACKET,0,0,0);return;}
 if(cmd==3){static const u8 prefix[8]={0x55,3,0,32,32,0,0,0};if(!equal(request,prefix,8)){make_reply(3,PACKET,0,0,0);return;}u8 v[32]={0,5};make_reply(3,0,0,32,v);return;}
 if(cmd!=0xd0||length>56||request[7]){make_reply(cmd,PACKET,0,0,0);return;}
 u8 sum=0;for(u32 i=4;i<8u+length;i++)sum+=request[i];if(sum!=request[3]){make_reply(cmd,PACKET,0,0,0);return;}
 for(u32 i=8+length;i<64;i++)if(request[i]){make_reply(cmd,PACKET,0,0,0);return;}
 u8 error=OK;
 if(op==0||op==1){u32 size=op==0?208:CFG_SIZE;if((u32)offset+length>size){make_reply(cmd,RANGE,0,0,0);return;}if(op==0){u8 status[208];status_bytes(status);make_reply(cmd,0,offset,length,status+offset);}else make_reply(cmd,0,offset,length,(const u8*)&S->cfg+offset);return;}
 if(op==2){if(!length||(u32)offset+length>CFG_SIZE)error=RANGE;else if(offset&&!S->staging)error=STAGING;else{if(!offset){S->staging=1;bytes_zero(S->coverage,sizeof(S->coverage));bytes_zero(&S->staged,CFG_SIZE);}bytes_copy((u8*)&S->staged+offset,request+8,length);for(u32 i=offset;i<offset+length;i++)S->coverage[i>>3]|=1u<<(i&7);}}
 else if(op==3){if(offset||length!=4)error=PACKET;else error=apply_staged(get32(request+8));}
 else if(offset||length)error=PACKET;else error=control(op);
 make_reply(cmd,error,0,0,0);
}
static int recovery_request(const u8*r){static const u8 p[9]={0x5f,6,0,0x52,1,0,0,0,0x51};if(!equal(r,p,9))return 0;for(u32 i=9;i<64;i++)if(r[i])return 0;return 1;}
__attribute__((section(".entry"),noreturn)) void firmware_main(void){
 /* Startup already initialized gp/sp, native data/BSS and SystemInit. */
 bytes_zero((u8*)S+64,sizeof(App)-64);S->legacy[5]=16;config_defaults(&S->cfg);all_released();
 native_void(0x795e);native_void(0x15e7e);native_void(0x52c0);((void(*)(u32))0x5412)(1);time_init();
 for(u32 i=0;i<(u32)(__ramcode_end-__ramcode_start);i++)__ramcode_start[i]=__ramcode_load[i];__asm__ volatile("fence.i":::"memory");
 load_saved();S->scan_error=adc_init();if(S->scan_error)S->enabled=0;S->legacy[5]=48;
 for(;;){
  if(usb_ready()&&!S->vendor_pending&&MM8(0x20000273)){
   u8 request[64];u8 received=MM8(0x20000275);for(u32 i=0;i<64;i++)request[i]=RX[i];MM8(0x20000273)=0;
   if(received==64&&recovery_request(request)){
    S->enabled=0;all_released();keyboard_service();for(u32 i=0;i<64;i++)RX[i]=request[i];MM32(0xe000f000)=0;native_void(0x67b0);time_init();make_reply(6,STATE,0,0,0);
   }else if(received==64)vendor_request(request);else make_reply(0xd0,PACKET,0,0,0);
  }
  if(!S->scan_error){u16 input[N];u8 error=adc_frame(input);if(error){S->scan_error=error;S->enabled=0;all_released();}else engine_step(input);}
  keyboard_service();
  if(S->vendor_pending&&usb_ready()&&upload(2,S->vendor,64,1)==1)S->vendor_pending=0;
 }
}
