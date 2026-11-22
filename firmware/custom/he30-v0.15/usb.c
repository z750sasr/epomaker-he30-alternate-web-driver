/* The donor's USB interrupt handler owns enumeration, endpoint DMA and bus
 * resets. These additions supply the Xbox-compatible interface and its OS
 * descriptor without replacing the working keyboard/configuration paths.
 * Native addresses are pinned to the v0.3 base hash in build.py.
 */
#define USB_CONFIG_RAM 0x20000100u
#define USB_EP0_BUFFER 0x2000032cu
#define USB_SETUP_POINTER 0x20000258u
#define USB_SETUP_REQUEST 0x2000025cu
#define USB_SETUP_TYPE 0x2000025du
#define USB_SETUP_VALUE 0x2000025eu
#define USB_SETUP_INDEX 0x20000260u
#define USB_SETUP_LENGTH 0x20000262u

__attribute__((section(".spare_data"))) static const u8 usb_xinput_configuration[106]={
 9,2,106,0,3,1,0,0x80,250,
 /* Existing boot keyboard, EP1 IN. */
 9,4,0,0,1,3,1,1,0,
#ifdef HE30_NKRO
 9,0x21,0x11,1,0,1,0x22,49,0,
 7,5,0x81,3,KEYBOARD_REPORT_BYTES,0,1,
#else
 9,0x21,0x11,1,0,1,0x22,62,0,
 7,5,0x81,3,8,0,1,
#endif
 /* Existing 64-byte configuration HID, EP2 IN / EP4 OUT. */
 9,4,1,0,2,3,0,0,0,
 9,0x21,0x10,1,0,1,0x22,32,0,
 7,5,0x82,3,64,0,1,
 7,5,4,3,64,0,1,
 /* Xbox 360 wired-controller interface, EP3 IN and OUT. */
 9,4,2,0,2,0xff,0x5d,1,0,
 17,0x21,0,1,1,0x25,0x83,20,0,0,0,0,0x13,3,8,0,0,
 7,5,0x83,3,32,0,1,
 7,5,3,3,32,0,1
};
__attribute__((section(".spare_data"))) static const u8 usb_ms_string[18]={
 18,3,'M',0,'S',0,'F',0,'T',0,'1',0,'0',0,'0',0,0x20,0
};
__attribute__((section(".spare_data"))) static const u8 usb_ms_compatible[40]={
 40,0,0,0,0,1,4,0,1,0,0,0,0,0,0,0,
 2,1,'X','U','S','B','1','0',0,0,0,0,0,0,0,0,
 0,0,0,0,0,0,0,0
};

static void usb_gamepad_setup(u8 enabled){
 /* The native initialized configuration occupies only 91 bytes. Leave its
  * following data intact. The setup hook serves the larger descriptor. */
 MM8(USB_CONFIG_RAM+2)=enabled?106:66;
 MM8(USB_CONFIG_RAM+3)=0;
 MM8(USB_CONFIG_RAM+4)=enabled?3:2;
}

__attribute__((used,section(".early"),noinline)) int usb_gamepad_control(void){
 const u8 type=MM8(USB_SETUP_TYPE),request=MM8(USB_SETUP_REQUEST);
 const u16 value=MM16(USB_SETUP_VALUE),index=MM16(USB_SETUP_INDEX);
 const u8 enabled=MM8(USB_CONFIG_RAM+4)==3;
 const u8 *descriptor;
 u16 length;
 u8 descriptor_type=0;
 if(enabled&&type==0x80&&request==6&&value==0x0100&&index==0){
  /* Windows caches OS descriptor support by VID, PID and USB revision. */
  descriptor=(const u8 *)0x172c4;
  length=18;descriptor_type=1;
 }else if(type==0x80&&request==6&&(value==0x0200||value==0x0700)&&index==0){
  descriptor=usb_xinput_configuration;
  length=enabled?106:66;
  descriptor_type=value>>8;
 }else if(enabled&&type==0x80&&request==6&&value==0x03ee&&(index==0||index==0x0409)){
  descriptor=usb_ms_string;length=sizeof(usb_ms_string);
 }else if(enabled&&type==0xc0&&request==0x20&&value==0&&index==4){
  descriptor=usb_ms_compatible;length=sizeof(usb_ms_compatible);
 }else return 0;
 const u16 requested=MM16(USB_SETUP_LENGTH);
 if(requested<length)length=requested;
 const u16 count=length>64?64:length;
 bytes_copy((void *)USB_EP0_BUFFER,descriptor,count);
 if(descriptor_type==1){
  if(count>12)MM8(USB_EP0_BUFFER+12)=1;
 }else if(descriptor_type){
  if(count>1)MM8(USB_EP0_BUFFER+1)=descriptor_type;
  if(count>2)MM8(USB_EP0_BUFFER+2)=enabled?106:66;
  if(count>4)MM8(USB_EP0_BUFFER+4)=enabled?3:2;
 }
 /* The native common path subtracts the first packet and advances subsequent
  * GET_DESCRIPTOR packets using this pointer. Both OS replies fit in one. */
 MM32(USB_SETUP_POINTER)=(u32)(descriptor+count);
 MM16(USB_SETUP_LENGTH)=length;
 return 1;
}
