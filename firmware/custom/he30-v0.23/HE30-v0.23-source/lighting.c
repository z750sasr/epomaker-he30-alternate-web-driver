/* HE30 v0.9 dual-pin RGB power-on bring-up.
 * PA9 and PA10 both have traced associations with keyboard LED VCC.
 * PB15 -> main RGB DIN; PB5 -> independently powered RGB bar DIN.
 * Sibling firmware uses both pins (LOW output and floating input modes),
 * but their exact electrical LED power roles remain unverified.
 * IMPORTANT: output-HIGH mode assumes BOTH pins drive logic-level control
 * inputs, NOT that either is directly driven by a 5 V supply.
 * Select RGB_POWER_MODE for the verified circuit before flashing.
 * Both RGB streams use finite startup retransmits and apply saved lighting.
 */
#ifndef RGB_POWER_MODE
#define RGB_POWER_MODE 1
#endif
#if RGB_POWER_MODE < 1 || RGB_POWER_MODE > 4
#error "RGB_POWER_MODE must be 1 (both HIGH), 2 (both LOW), 3 (both floating), or 4 (PA9 HIGH / PA10 floating)"
#endif
#define RGB_CTL_MASK ((1u<<9)|(1u<<10))

static const u8 led_to_key[N]={23,0,1,2,3,4,5,12,18,19,21,20,22,6,13,14,15,16,17,35,24,30,31,33,32,34,25,26,27,28,29,11,7,9,8,10};
static const u8 waves[4]={0x88,0x8e,0xe8,0xee};
static void lighting_defaults(void){
 bytes_zero(&S->light,128);S->light.version=1;S->light.mode=1;S->light.count=5;S->light.bar_on=1;
 S->light.r=S->light.g=S->light.b=16;S->light.br=S->light.bg=S->light.bb=16;
 S->identify=255;S->rgb_pending=3;
}
static int lighting_valid(const Lighting*l){
 if(l->version!=1||l->mode>5||(l->order>>1)>100||(l->rate>>1)>100||l->count>5||l->bar_on>1||(l->bar_on&&!l->count))return 0;
 const u8*p=&l->r;for(u32 i=0;i<114;i++)if(p[i]>32)return 0;
 for(u32 i=0;i<8;i++)if(l->reserved[i])return 0;return 1;
}
static void lighting_status(u8*out){
 bytes_zero(out,160);put32(out,0x314c3348);out[4]=4;out[5]=S->rgb_error;out[6]=S->rgb_state;out[7]=S->rgb_pending;
 put32(out+8,S->key_frames);put32(out+12,S->bar_frames);bytes_copy(out+16,&S->light,128);
 /* Legacy PA9 diagnostics preserved in 144-147. */
 out[144]=(MM32(0x40010804u)>>4)&15u; /* PA9 config nibble */
 out[145]=(MM32(0x40010808u)>>9)&1u;  /* PA9 physical level */
 out[146]=(MM32(0x4001080cu)>>9)&1u;  /* PA9 output latch */
 out[147]=(MM32(0x40021018u)>>2)&1u; /* GPIOA clock enabled */
 /* New dual-pin power diagnostics. */
 out[148]=(MM32(0x40010804u)>>8)&15u; /* PA10 config nibble */
 out[149]=(MM32(0x40010808u)>>10)&1u; /* PA10 physical level */
 out[150]=(MM32(0x4001080cu)>>10)&1u; /* PA10 output latch */
 out[151]=RGB_POWER_MODE;
 out[152]=S->rgb_retry_left;
}
#ifdef HE30_FN_RGB
/* Each slot has a distinct 128-byte address range on the wire. A 73-byte
 * palette is enabled byte + 36 little-endian base-33 RGB words. */
__attribute__((section(".fncode"),noinline))
static void fn_rgb_request(u8 op,u16 offset,u8 count,const u8 *data){
 const u32 slot=offset>>7,position=offset&127u;
 if(slot>=2*PROFILE_COUNT||position+count>FN_RGB_WIRE_BYTES){
  make_reply(0xd1,RANGE,0,0,0);return;
 }
 const u32 profile=slot>>1,layer=slot&1u,mask=1u<<layer;
 u8 *colors=(u8 *)S->fn_light.colors[profile][layer];
 if(op==9){
  u8 encoded[FN_RGB_WIRE_BYTES];
  encoded[0]=!!(S->fn_light.enabled[profile]&mask);
  bytes_copy(encoded+1,colors,2*N);
  make_reply(0xd1,OK,offset,count,encoded+position);return;
 }
 int result=OK;
 if(profile!=S->library.active)result=STATE;
 else if(position==0&&count==FN_RGB_FIRST_CHUNK){
  S->fn_rgb_target=0;
  if(data[0]>1)result=RANGE;
  for(u32 i=1;i<count;i+=2)if(get16(data+i)>FN_RGB_MAX_COLOR)result=RANGE;
  if(!result){
   bytes_copy(S->fn_rgb_draft,data,count);
   S->fn_rgb_target=slot+1;
  }
 }else if(position==FN_RGB_FIRST_CHUNK&&count==FN_RGB_WIRE_BYTES-FN_RGB_FIRST_CHUNK){
  if(S->fn_rgb_target!=slot+1)result=STAGING;
  else{
   S->fn_rgb_target=0;
   for(u32 i=0;i<count;i+=2)if(get16(data+i)>FN_RGB_MAX_COLOR)result=RANGE;
   if(!result){
    bytes_copy(colors,S->fn_rgb_draft+1,FN_RGB_FIRST_CHUNK-1);
    bytes_copy(colors+FN_RGB_FIRST_CHUNK-1,data,count);
    S->fn_light.enabled[profile]=(S->fn_light.enabled[profile]&~mask)|(S->fn_rgb_draft[0]<<layer);
    S->rgb_pending|=1;S->dirty=1;
   }
  }
 }else result=PACKET;
 make_reply(0xd1,result,0,0,0);
}
#endif

static void lighting_request(const u8*r){
 u8 op=r[2],n=r[4],error=0;u16 off=get16(r+5);const u8*p=r+8;
#ifdef HE30_FN_RGB
 if(op==9||op==10){fn_rgb_request(op,off,n,p);return;}
#endif
 if(op==8){
  if(off+n>123)make_reply(0xd1,RANGE,0,0,0);
  else{
   u8 live[123];
   bytes_copy(live,S->live_keys,108);bytes_copy(live+108,S->live_bar,15);
   make_reply(0xd1,OK,off,n,live+off);
  }
  return;
 }
 if(op==0){if((u32)off+n>160)error=RANGE;else{u8 out[160];lighting_status(out);make_reply(0xd1,0,off,n,out+off);return;}}
 else if(off)error=PACKET;
 else if(op==1){
  if(n!=12)error=PACKET;else{Lighting next;bytes_copy(&next,&S->light,128);bytes_copy(&next,p,12);if(!lighting_valid(&next))error=RANGE;else{bytes_copy(&S->light,&next,128);S->identify=255;S->rgb_error=0;S->rgb_pending=3;S->dirty=1;}}
 }else if(op==2){
  if(!n||n%4)error=PACKET;
  else{for(u32 i=0;i<n;i+=4)if((p[i]>=36&&p[i]!=255)||p[i+1]>32||p[i+2]>32||p[i+3]>32)error=RANGE;
   if(!error){for(u32 i=0;i<n;i+=4)for(u32 k=0;k<N;k++)if(p[i]==k||p[i]==255)bytes_copy(S->light.palette[k],p+i+1,3);S->dirty=1;S->identify=255;S->rgb_error&=~1u;S->rgb_pending|=1;
   }
  }
 }else if(op==3){if(n!=1)error=PACKET;else if(p[0]>=36&&p[0]!=255)error=RANGE;else{S->identify=p[0];S->identify_until=ticks()+2000*TICKS_MS;S->rgb_pending|=1;}}
 else if(n)error=PACKET;
 else if(op==4){S->light.mode=S->light.bar_on=0;S->identify=255;S->rgb_pending=3;S->dirty=1;}
 else if(op==5){S->rgb_error=0;S->rgb_pending=3;}
 else if(op==6){lighting_defaults();S->dirty=1;}
 else error=RANGE;
 make_reply(0xd1,error,0,0,0);
}
/* Configure both control pins together. The sibling binary configures
 * PA9 and PA10 as push-pull outputs LOW and can change them to floating
 * inputs (GPIO mode 0x4). That is not proof that LOW or floating enables
 * the LEDs on this HE30 board. The default test mode is both HIGH based
 * on the user-traced NPN/P-MOSFET high-side switch topology.
 * GPIOA CRH: PA9 bits [7:4], PA10 bits [11:8].
 * CH32/STM32-style GPIO: 0x2 = 2MHz push-pull; 0x4 = floating input.
 */
static void rgb_power_init(void){
 MM32(0x40021018u) |= (1u<<2); /* GPIOA clock */
 /* Sibling-like safe initial state: both output latches LOW. */
 MM32(0x40010814u)=RGB_CTL_MASK; /* GPIOA BCR, atomic clear */
 u32 crh=MM32(0x40010804u);
 crh &= ~0x00000ff0u;
 crh |=  0x00000220u; /* both 2MHz push-pull outputs */
 MM32(0x40010804u)=crh;
#if RGB_POWER_MODE == 1
 /* Both high, if and only if they are verified logic-level enables. */
 MM32(0x40010810u)=RGB_CTL_MASK;
#elif RGB_POWER_MODE == 2
 /* Exact sibling-style LOW output state (not proven to power LEDs). */
#elif RGB_POWER_MODE == 3
 /* Sibling-style temporary floating-input state for both pins. */
 crh=MM32(0x40010804u);
 MM32(0x40010804u)=(crh&~0x00000ff0u)|0x00000440u;
#elif RGB_POWER_MODE == 4
 /* PA9 drives NPN enable; PA10 stays high-impedance. */
 MM32(0x40010810u)=(1u<<9);
 crh=MM32(0x40010804u);
 MM32(0x40010804u)=(crh&~0x00000f00u)|0x00000400u;
#endif
}

/* Initialize RGB immediately after the native clock/USB startup. No
 * calibration, saved settings, ADC success or USB enumeration needed.
 * A fixed number of follow-up frames cover LED power-supply delays. */
static void rgb_boot(void){
 /* Enable AFIO + GPIOA + GPIOB clocks. */
 MM32(0x40021018u) |= 0xdu;
 /* PB15 and PB5 data idle LOW before switching GPIO pin modes. */
 MM32(0x40010c14u) = (1u<<15) | (1u<<5);
 MM32(0x40010c04u) = (MM32(0x40010c04u)&~0xf0000000u)|0x20000000u;
 MM32(0x40010c00u) = (MM32(0x40010c00u)&~0x00f00000u)|0x00200000u;
 rgb_power_init();
 S->rgb_path=1;      /* both pending -> transmit lightbar, then keys */
 S->rgb_pending=3;
 S->rgb_error=0;
 S->rgb_started=ticks();
 S->rgb_state=3;     /* nonblocking 10 ms settling period */
 S->rgb_retry_left=8;  /* 8 additional refreshes, 250 ms apart */
 S->rgb_retry_next=ticks()+250u*TICKS_MS;
}
static u32 rgb_spi(void){return S->rgb_path==1?0x40003800:0x40013000;}
static u32 rgb_dma(void){return S->rgb_path==1?0x40020058:0x40020030;}
static void rgb_cleanup(void){
 u32 spi=rgb_spi();MM32(rgb_dma())=0;MM16(spi+4)=0;MM16(spi)=0;
 /* Known data net only; idle low. No clock/debug/LED power pins are touched. */
 if(S->rgb_path==1){MM32(0x40010c14)=0x8000;MM32(0x40010c04)=(MM32(0x40010c04)&0x0fffffff)|0x20000000;}
 else{MM32(0x40010c14)=0x20;MM32(0x40010c00)=(MM32(0x40010c00)&~0xf00000u)|0x200000;}
 S->rgb_state=0;
}
__attribute__((section(".spare"),noinline)) static void rgb_failed(void){
 /* Retry each output once after a DMA/SPI error, then surface the fault. */
 if(!(S->rgb_error&S->rgb_path))S->rgb_pending|=S->rgb_path;
 S->rgb_error|=S->rgb_path;
 rgb_cleanup();
}
#ifdef HE30_FN_RGB
__attribute__((section(".fncode"),noinline))
#endif
VERIFY_ENTRY void rgb_service(void){
 if(S->rgb_state==3){
  if((u32)(ticks()-S->rgb_started)<10u*TICKS_MS)return;
  S->rgb_state=0;
 }
 if(S->rgb_state){
  /* DMA1 TEIF5 / TEIF3: failures on one chain must not block the other. */
  u32 te=S->rgb_path==1?0x80000u:0x800u;
  if(MM32(0x40020000)&te){rgb_failed();return;}
  if(S->rgb_state==1){u32 tc=S->rgb_path==1?0x20000:0x200;if(MM32(0x40020000)&tc)S->rgb_state=2;}
  if(S->rgb_state==2&&!(MM16(rgb_spi()+8)&128)){
   if(S->rgb_path==1){bytes_copy(S->live_keys,S->rgb_colors,sizeof(S->live_keys));S->key_frames++;}
   else{bytes_copy(S->live_bar,S->rgb_colors,sizeof(S->live_bar));S->bar_frames++;}
   S->rgb_error&=~S->rgb_path;
   rgb_cleanup();
  }
  else if((u32)(ticks()-S->rgb_started)>20u*TICKS_MS){
   rgb_failed();
  }
  return;
 }
 /* Retry both outputs after the first frame in case LED VCC rose late.
  * Fixed, finite retransmission avoids continuous SPI traffic. */
 if(!S->rgb_pending && S->rgb_retry_left &&
    (i32)(ticks()-S->rgb_retry_next)>=0){
  S->rgb_pending=3;
  S->rgb_retry_left--;
  S->rgb_retry_next+=250u*TICKS_MS;
 }
 if(S->identify!=255&&(i32)(ticks()-S->identify_until)>=0){S->identify=255;S->rgb_pending|=1;}
 const u32 now=ticks();
#ifdef HE30_FN_RGB
 const u32 profile=S->library.active;
 const u8 fn=S->fn&&(S->fn_light.enabled[profile]&(1u<<(S->fn-1)))?S->fn:0;
 if(fn!=S->rendered_fn)S->rgb_pending|=1;
#endif
 if(S->light.mode>=4&&now-S->rgb_effect_time>=33u*TICKS_MS){S->rgb_pending|=1;S->rgb_effect_time=now;}
 if(!S->rgb_pending)return;
 S->rgb_path=S->rgb_pending==3?3-S->rgb_path:S->rgb_pending;
 S->rgb_pending&=~(1u<<(S->rgb_path-1));
 const u32 count=S->rgb_path==1?N:5;
#ifdef HE30_FN_RGB
 if(S->rgb_path==1)S->rendered_fn=fn;
#endif
 bytes_zero(S->rgb_frame,128+count*12);
 const u32 animation=now/(10u*TICKS_MS);
 /* Header high bits store dimming as 100 minus the requested brightness.
  * Legacy profiles leave them zero, which yields full configured intensity. */
 const u32 brightness=100u-((S->rgb_path==1?S->light.order:S->light.rate)>>1);
 for(u32 j=0;j<count;j++){
  u8 color[3]={0,0,0};
  if(S->rgb_path==1){
   u8 key=led_to_key[j];
#ifdef HE30_FN_RGB
   if(fn){
    const u32 value=S->fn_light.colors[profile][fn-1][key];
    color[0]=value/(33u*33u);color[1]=(value/33u)%33u;color[2]=value%33u;
   }else
#endif
   if(S->light.mode==1)bytes_copy(color,&S->light.r,3);
   else if(S->light.mode==2)bytes_copy(color,S->light.palette[key],3);
   else if(S->light.mode==3 && S->active[key])bytes_copy(color,&S->light.r,3);
   else if(S->light.mode==4){
    const u32 position=(animation+5*j)%192;
    const u32 segment=position>>6,amplitude=(position&63)>>2;
    color[segment]=16-amplitude;color[(segment+1)%3]=amplitude;
   }else if(S->light.mode==5){
    const u32 phase=animation%192,level=phase<=96?phase:192-phase;
    const u8 *base=&S->light.r;
    for(u32 i=0;i<3;i++)color[i]=base[i]*level/96;
   }
  }else{
   if(S->light.bar_on&&j<S->light.count)bytes_copy(color,&S->light.br,3);
  }
  for(u32 i=0;i<3;i++)color[i]=(color[i]*brightness+50)/100;
  const u32 key=S->rgb_path==1?led_to_key[j]:j;
  if(S->rgb_path==1&&S->identify!=255)
   color[0]=color[1]=color[2]=S->identify==key?24:0;
  bytes_copy(S->rgb_colors[key],color,3);
  const u32 order=S->light.order&1;
  const u32 bits=((u32)color[order?0:1]<<16)|((u32)color[order?1:0]<<8)|color[2];
  for(u32 i=0;i<12;i++)S->rgb_frame[64+j*12+i]=waves[(bits>>(22-2*i))&3];
 }
 MM32(0x40021018)|=8;MM32(0x40021014)|=1;
 if(S->rgb_path==1){MM32(0x4002101c)|=0x4000;MM32(0x40010c14)=0x8000;MM32(0x40010c04)=(MM32(0x40010c04)&0x0fffffff)|0xb0000000;}
 else{MM32(0x40021018)|=0x1001;MM32(0x40010004)|=1;MM32(0x40010c14)=0x20;MM32(0x40010c00)=(MM32(0x40010c00)&~0xf00000u)|0xb00000;}
 u32 spi=rgb_spi(),dma=rgb_dma();MM32(dma)=0;MM16(spi+4)=0;MM16(spi)=0;
 MM32(0x40020004)=S->rgb_path==1?0xf0000:0xf00;
 MM32(dma+4)=128+count*12;MM32(dma+8)=spi+12;MM32(dma+12)=(u32)S->rgb_frame;
 const u16 strip_rate=((MM32(0x40021004)&0x3800)==0x2000?0x35c:0x364)+(S->light.rate&1)*8;
#ifdef HE30_ADC_RGB_FIX
 /* Use the slower waveform on the long key chain, including Fn palettes.
  * The saved rate still selects the separate five-pixel lightbar timing. */
 MM16(spi)=S->rgb_path==1?0x364:strip_rate;
#else
 MM16(spi)=S->rgb_path==1?0x35c+(S->light.rate&1)*8:strip_rate;
#endif
 MM32(dma)=0x2090;MM16(spi+4)=2;
 S->rgb_started=ticks();S->rgb_state=1;MM32(dma)=0x2091;
}
