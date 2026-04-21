let DegSprite;
{
  let svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.innerHTML+=`
<filter id="degSpriteChroma" color-interpolation-filters="sRGB" x="0" y="0" height="100%" width="100%">
<feComponentTransfer>
<feFuncR type="discrete"></feFuncR>
<feFuncG type="discrete"></feFuncG>
<feFuncB type="discrete"></feFuncB>
</feComponentTransfer>
<feColorMatrix type="matrix" values="1 0 0 0 0 
                                     0 1 0 0 0
                                     0 0 1 0 0 
                                     1 1 1 1 -3" result="selected"></feColorMatrix>
<feFlood></feFlood>
<feComposite in2="selected" operator="in"></feComposite>
</filter>`;
  document.body.appendChild(svg);
  
  let flood = svg.querySelector(`#degSpriteChroma feFlood`);
  let RGB = {}
  for(let c of ["R","G","B"])
    RGB[c.toLowerCase()] = svg.querySelector(`#degSpriteChroma feFunc${c}`);
  let matrix = svg.querySelector("#degSpriteChroma feColorMatrix");
  
  let encoder = new TextEncoder();
  let decoder = new TextDecoder();
  let header = encoder.encode("DgSp");
  let old = Symbol("old");
  let sheet = Symbol("sheet");
  
  DegSprite = function(degSprite){
    let t = new EventTarget();
    for(let k of Object.keys(EventTarget.prototype)){
      if(typeof(t[k])==typeof(()=>{})){
        this[k] = t[k].bind(t);
      }
    }
    /*
      use             data                 size
      
      Header          DgSp                 4 bytes
      version         bool mono/mixed      1 bit
      alpha           bool false/true      1 bit
      padding         00                   2 bits
      paletteMaxIndex Uint4                4 bits
      width           Uint32               4 bytes
      height          Uint32               4 bytes
      paletteColors   repeating PMX times{          
        r             0-255                1 byte
        g             0-255                1 byte
        b             0-255                1 byte
        [a]           0-255                1 byte
      }
      pixelData       repeating TP times{
        paletteIndex  Uint2/3/4            2/3/4 bits if PMX <3/<7/>=7
      }
      padding         00                   X bits to even out to a multiple of 8 bits
      [colored version only]
      fullPNG         full PNG data        rest of the file
    */
    let fast = false;
    let loadImage = arrayBuffer=>{
      let view = new DataView(arrayBuffer);
      if(view.getUint16(0)==((120<<8)|156)){
        new Response(new Blob([arrayBuffer],{type:"application/octet-stream"}).stream().pipeThrough(new DecompressionStream("deflate"))).blob().then(b=>{
          b.arrayBuffer().then(r=>{
            fast = true;
            loadImage(r);
          });
        });
        return;
      }
      
      if(decoder.decode(arrayBuffer.slice(0,4))!="DgSp"){
        let png = [137,80,78,71,13,10,26,10];
        if([0,1,2,3,4,5,6,7].some(n=>view.getUint8(n)!=png[n]))
          throw new Error("Unsupported file type. Only .dgsp and .png supported");
        this.palette = [];
        this.raw = new OffscreenCanvas(0,0);
        this.png = new Image();
        this.png.on("load",()=>{
          this.image = new OffscreenCanvas(this.png.naturalWidth,this.png.naturalHeight);
          this.loaded = true;
        });
        this.png.src = URL.createObjectURL(new Blob([arrayBuffer],{type:"image/png"}));
        return;
      }
      
      let info = view.getUint8(4);
      let mixed = !!(info & 0b10000000);
      let alpha = !!(info & 0b01000000);
      this.alpha = alpha;
      let paletteMaxIndex = (info & 0b1111);
      
      let index = 5;
      
      let width = view.getUint32(index);
      let height = view.getUint32(index+4);
      this.width = width;
      this.height = height;
      index+=8;
      
      this.palette = [];
      let gradientSize = paletteMaxIndex<7?32:16;
      let replaces = Symbol("replaces");
      for(let i=0;i<paletteMaxIndex+1;i++){
        let add = 3+alpha;
        let c = new Array(add).fill(0).map((_,n)=>view.getUint8(index+n));
        let tableValues = new Array(256).fill(0);
        let val = 255-i*gradientSize;
        tableValues[val] = 1;
        let pal = {color:`rgba(${c.concat(alpha?[]:[255]).join(",")})`};
        pal[replaces] = {
          rgb:[val,val,val,255],
          tableValues:tableValues.join(" ")
        };
        pal.canvas = document.createElement("canvas");
        pal.canvas.width = width;
        pal.canvas.height = height;
        pal.canvas.ctx = pal.canvas.getContext("2d");
        this.palette.push(pal);
        index+=add;
      }
      {
        let lastPal = {color:`rgba(0,0,0,0)`};
        let val = 255-(paletteMaxIndex+1)*gradientSize;
        let tableValues = new Array(256).fill(0);
        tableValues = tableValues.join(" ");
        lastPal[replaces] = {
          rgb:[val,val,val,255],
          tableValues
        };
        lastPal.canvas = document.createElement("canvas");
        lastPal.canvas.width = width;
        lastPal.canvas.height = height;
        lastPal.canvas.ctx = lastPal.canvas.getContext("2d");
        this.palette.push(lastPal);
      }
      
      let totalPixels = width*height;
      let pixelBits = (paletteMaxIndex<3?2:paletteMaxIndex<7?3:4);
      let pixelBytes = Math.ceil(totalPixels*pixelBits/8);
      
      let rawPixels = [];
      let mask = parseInt(new Array(pixelBits).fill(1).join(""),2);
      let count = 24/pixelBits;
      for(let i=0;i<pixelBytes;i+=3){
        let left = view.getUint8(index);
        let middle = view.getUint8(index+1);
        let right = view.getUint8(index+2);
        let pixels = (left<<16) | (middle<<8) | right;
        index+=3;
        
        let remaining = totalPixels-rawPixels.length;
        for(let j=0;j<Math.min(count,remaining);j++){
          let offset = 24-pixelBits*(1+j);
          let m = mask<<offset;
          rawPixels.push((pixels&m)>>offset);
        }
      }
      this.raw = new OffscreenCanvas(width,height);
      rawPixels = rawPixels.flatMap(p=>this.palette[p][replaces].rgb);
      this.raw.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rawPixels),width,height),0,0);
      
      let image = new OffscreenCanvas(width,height);
      image.ctx = image.getContext("2d");
      
      let copies = [new OffscreenCanvas(width,height)];
      
      Object.defineProperty(this,"image",{get(){
        let dirty = this.sheetInfo && (!copies || copies[0].width!=this.sheetInfo.width || copies[0].height!=this.sheetInfo.height);
        for(let cp of this.palette){
          if(cp.color==cp[old])
            continue;
          cp[old] = cp.color;
          
          for(let c of ["r","g","b"])
            RGB[c].setAttribute("tableValues",cp[replaces].tableValues);
          flood.setAttribute("flood-color",cp.color.replace("a","").replace(/,\d+?\)/,")"));
          
          cp.canvas.ctx.filter = `url(#degSpriteChroma)`;
          cp.canvas.ctx.clearRect(0,0,width,height);
          cp.canvas.ctx.drawImage(this.raw,0,0);
          
          image.ctx.globalAlpha = 1;
          image.ctx.globalCompositeOperation = "destination-out";
          image.ctx.drawImage(cp.canvas,0,0);
          image.ctx.globalAlpha = cp.color.match(/,(\d+)\)/)[1]/255;
          image.ctx.globalCompositeOperation = "source-over";
          image.ctx.drawImage(cp.canvas,0,0);
          dirty = true;
          
          if(cp==this.palette.last)
            continue;
          
          let rgb = cp.color.replace("rgba(","").replace(")","").split(",").slice(0,alpha?4:3);
          let i = this.palette.indexOf(cp);
          let index = 13+i*(3+alpha);
          for(let c of rgb){
            view.setUint8(index,c);
            index++;
          }
        }
        if(!this.png[old]){
          this.png[old] = true;
          image.ctx.filter = "none";
          image.ctx.drawImage(this.png,0,0,width,height);
          dirty = true;
        }
        if(dirty){
          if(this.sheetInfo){
            if(copies.length<this.sheetInfo.spriteCount){
              copies.inplaceConcat(new Array(this.sheetInfo.spriteCount-copies.length).fill(0)
                .map((_,i)=>new OffscreenCanvas(this.sheetInfo.width,this.sheetInfo.height))
              );
            }
            this.splitSheet(this.sheetInfo,image);
            copies[0].width = this.sheetInfo.width;
            copies[0].height = this.sheetInfo.height;
            for(let [i,c] of copies.entries()){
              let ctx = c.getContext("2d");
              ctx.reset();
              ctx.drawImage(this[sheet][i],0,0);
            }
          }else{
            let ctx = copies[0].getContext("2d");
            ctx.reset();
            ctx.drawImage(image,0,0);
          }
          if(!fast){
            requestAnimationFrame(()=>this.dispatchEvent(new Event("draw")));
            fast = true;
          }else
            this.dispatchEvent(new Event("draw"));
        }
        return this[sheet]?copies[this.sheetInfo.currentFrame]:copies[0];
      }});
      
      Object.defineProperty(this,"toBuffer",{get(){
        return async function(){
          return new Promise(res=>{
            new Response(new Blob([arrayBuffer],{type:"application/octet-stream"}).stream().pipeThrough(new CompressionStream("deflate"))).blob().then(b=>{
              b.arrayBuffer().then(r=>res(r));
            });
          });
        }
      }});
      
      if(!mixed){
        this.png = new Image();
        this.loaded = true;
        this.forceRedraw();
      }else{
        this.png = new Image();
        this.png.on("load",()=>{
          this.loaded = true;
          this.forceRedraw();
        });
        this.png.on("error",e=>{throw e});
        this.png.src = URL.createObjectURL(new Blob([arrayBuffer.slice(index)],{type:"image/png"}));
      }
    }
    
    if(typeof(degSprite)==typeof("")){
      fetch(degSprite).then(r=>r.blob()).then(b=>loadImage(b.arrayBuffer()));
      return this;
    }
    let buffer = !degSprite?
      null
    :degSprite instanceof ArrayBuffer?
      degSprite
    :degSprite.buffer instanceof ArrayBuffer?
      degSprite.buffer
    :typeof(degSprite.arrayBuffer)==typeof(()=>{}) && (degSprite.arrayBuffer() instanceof ArrayBuffer)?
      degSprite.arrayBuffer()
    :
      null
    ;
    if(!buffer)
      throw new Error("You must pass an ArrayBuffer, object with an ArrayBuffer in its .buffer property (like a Uint8Array), or an object with a .arrayBuffer() function (like a Blob) to the DegSprite constructor.");
    loadImage(buffer);
  }
  
  DegSprite.prototype.forceRedraw = function(){
    for(let cp of this.palette)
      cp[old] = false;
    this.png[old] = false;
    this.image;
  }
  
  DegSprite.prototype.splitSheet = async function({holds=[],width=32,height=32,currentFrame=0,currentHold=0,spriteCount}={},img){
    return new Promise(res=>{
      let split = ()=>{
        if(!this.loaded)
          return requestAnimationFrame(split);
        spriteCount = spriteCount?spriteCount:this.width*this.height/width/height;
        this.sheetInfo = {
          holds:holds.concat(holds.length==spriteCount?[]:new Array(spriteCount-holds.length).fill(1)),
          currentFrame,
          currentHold,
          width,
          height,
          spriteCount
        };
        if(!img)
          return res();
        this[sheet] = new Array(spriteCount).fill(0).map((_,i)=>{
          let sprite = new OffscreenCanvas(width,height);
          let left = (i*width)%this.width;
          let top = Math.floor(i*width/this.width)*height;
          sprite.getContext("2d").drawImage(img,left,top,width,height,0,0,width,height);
          return sprite;
        });
        res();
      }
      split();
    });
  }
  
  DegSprite.prototype.animate = function(){
    if(!this.sheetInfo)
      throw new Error("You must call .splitSheet before calling .animate");
    this.sheetInfo.currentHold++;
    if(this.sheetInfo.currentHold>=this.sheetInfo.holds[this.sheetInfo.currentFrame]){
      this.sheetInfo.currentFrame++;
      this.sheetInfo.currentHold = 0;
      if(this.sheetInfo.currentFrame>=this.sheetInfo.holds.length)
        this.sheetInfo.currentFrame = 0;
    }
  }
  
  DegSprite.encodePNG = async function(canBeDrawnToCanvas,{palette,transparency=false,precolored,extraColorsToPNG}={}){
    return new Promise(res=>{
      let makePalette = !palette;
      extraColorsToPNG = extraColorsToPNG!==undefined?!!extraColorsToPNG:!makePalette;
      
      let width = canBeDrawnToCanvas.nautralWidth || canBeDrawnToCanvas.width;
      let height = canBeDrawnToCanvas.nautralHeight || canBeDrawnToCanvas.height;
      let ctx = new OffscreenCanvas(width,height).getContext("2d");
      ctx.drawImage(canBeDrawnToCanvas,0,0);
      let data = Array.from(ctx.getImageData(0,0,width,height).data);
      
      let pixels = [];
      let png = [];
      if(makePalette){
        palette = [];
        for(let i=0;i<data.length;i+=4){
          if(data[i+3]==0 || (transparency===false && data[i+3]!=255)){
            pixels.push(-1);
            png.push([0,0,0,0]);
            continue;
          }
          if(!transparency && data[i+3]<255)
            transparency = true;
          
          let pal = [0,1,2,3].map(n=>n<3 || transparency?data[i+3]==0 && transparency?0:data[i+n]:255);
          let existing = palette.find(p=>p.every((c,i)=>c==pal[i]));
          if(!existing){
            if((palette.length==15 || (transparency && palette.length==16)) && extraColorsToPNG){
              pixels.push(-1);
              png.push(pal);
            }else{
              pixels.push(palette.length);
              palette.push(pal);
              png.push([0,0,0,0]);
            }
          }else{
            pixels.push(palette.indexOf(existing));
            png.push([0,0,0,0]);
          }
          
          if(palette.length>16 || (pixels.some(p=>p<0) && palette.length>15))
            throw new Error("Too many colors to create palette programatically. A maximum of 16 colors is supported. Transparent is a color.\n\nIf you want DegSprite.encodePNG to send the colors it finds above this limit to a separate layer of consistent color, set the extraColorsToPNG option to true.");
        }
      }else{
        palette = palette.map(p=>p.length==4?p:p.concat([255]));
        if(precolored){
          for(let i=0;i<data.length;i+=4){
            let pdata = [0,1,2,3].map(n=>data[i+n])
            let existing = palette.find(p=>p.every((c,i)=>c==pdata[i]));
            pixels.push(existing?palette.indexOf(existing):-1);
            png.push(existing || !extraColorsToPNG?[0,0,0,0]:pdata);
          }
        }else{
          let greyscale = new Array(palette.length).fill(0).map((_,i)=>255-(palette.length<7?32:16)*i);
          for(let i=0;i<data.length;i+=4){
            let pdata = [0,1,2].map(n=>data[i+n]);
            let existing = greyscale.find(p=>pdata.every(c=>c==p));
            pixels.push(existing?greyscale.indexOf(existing):-1);
            png.push(existing || !extraColorsToPNG?[0,0,0,0]:pdata.concat([data[i+3]]));
          }
        }
      }
      
      let out = ()=>{
    /*
      use             data                 size
      
      Header          DgSp                 4 bytes
      version         bool mono/mixed      1 bit
      alpha           bool false/true      1 bit
      padding         00                   2 bits
      paletteMaxIndex Uint4                4 bits
      width           Uint32               4 bytes
      height          Uint32               4 bytes
      paletteColors   repeating PMX times{          
        r             0-255                1 byte
        g             0-255                1 byte
        b             0-255                1 byte
        [a]           0-255                1 byte
      }
      pixelData       repeating TP times{
        paletteIndex  Uint2/3/4            2/3/4 bits if PMX <3/<7/>=7
      }
      padding         00                   X bits to even out to a multiple of 8 bits
      [colored version only]
      fullPNG         full PNG data        rest of the file
    */
        
        transparency = !!transparency;
        
        let version = (!!png)<<7;
        let alpha = transparency<<6;
        let paletteMaxIndex = palette.length-1;
        
        let pixelBits = (paletteMaxIndex<3?2:paletteMaxIndex<7?3:4);
        let pixelData = [];
        pixels = pixels.map(p=>p>=0?p:palette.length==16?paletteMaxIndex:palette.length);
        for(let i=0;i<pixels.length;i){
          let p = 0;
          for(let j=0;j<24/pixelBits;j++){
            p|=pixels[i]<<(24-pixelBits*(1+j));
            i++;
          }
          pixelData.push(p);
        }
        pixelData = pixelData.flatMap(p=>[(p&0b111111110000000000000000)>>16,(p&0b1111111100000000)>>8,p&0b11111111]);
        
        let fileLength = 4+1+palette.length*(3+transparency)+4+4+pixelData.length+(png?png.length:0);
        
        let array = new Uint8Array(fileLength);
        for(let i=0;i<4;i++)
          array[i] = header[i];
        array[4] = version | alpha | paletteMaxIndex;
        
        let index = 5;
        
        let view = new DataView(array.buffer);
        view.setUint32(index,width);
        view.setUint32(index+4,height);
        index+=8;
        
        for(let p of palette){
          for(let i=0;i<3+transparency;i++)
            array[index+i] = p[i];
          index+=3+transparency;
        }
        
        for(let p of pixelData){
          array[index] = p
          index++;
        }
        
        if(png){
          for(let p of png){
            array[index] = p;
            index++;
          }
        }
        
        new Response(new Blob([array],{type:"application/octet-stream"}).stream().pipeThrough(new CompressionStream("deflate"))).blob().then(b=>{
          b.arrayBuffer().then(r=>res(r));
        });
      }
      
      if(png.some(p=>p[3]!=0)){
        png = png.flatMap(p=>p);
        let c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(new Uint8Array(png)),width,height),0,0);
        c.toBlob(b=>{
          let r = new FileReader();
          r.on("load",()=>{
            png = new Uint8Array(r.result);
            out();
          });
          r.on("error",e=>{throw e});
          r.readAsArrayBuffer(b);
        });
      }else{
        png = false;
        out();
      }
    });
  }
}
