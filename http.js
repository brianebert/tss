const isBrowser=new Function("try {return this===window;}catch(e){ return false;}")();
console.log(`isBrowser is`, isBrowser);
console.log(isBrowser ? `detected browser` : `detected node`);

if(isBrowser) {
  //  window.Buffer so Stellar stuff works in the browser
  await import('buffer').then(mod => window.Buffer = mod.Buffer);
}
else {
  var [Blob, Buffer, https] = await Promise.all([import('buffer'), import('https')])
                              .then(([bufMod, httpMod]) => [bufMod.Blob, bufMod.Buffer, httpMod]);
  
  async function BS(url){
    console.log(`want to track `, url);
    this.retry = 1000;
    const response = await fetch(url, { method: "GET", headers: {"Accept": "text/event-stream"}});
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    while (true) {
      console.log(`setting timeOut to -${this.retry}- milliseconds at `, new Date());
      await new Promise((resolve, reject) => setTimeout(()=>resolve(), this.retry));
      console.log(`timed out at `, new Date());
      const { value, done } = await reader.read();
      console.log(`reader read at `, new Date());
      if (done) break;
      //const records = JSON.parse(decoder.decode(value))._embedded.records;//._embedded.records.pop();
      const received = decoder.decode(value);
      const lines = received.split(`\n`);
      for(const line of lines){
        console.log(`reading line - `, line);
        if(line.startsWith('retry: ')){
          console.log(`received retry: `, line.slice('retry: '.length));
          //this.retry = 5000;//parseInt(line.slice('retry: '.length));
        }
        if(line.startsWith('id: ')){
          console.log(`receiving record for ledger `, line.slice('id: '.length));
          this.onmessage();
        }
      }
      //console.log(`received ${decoder.decode(value)}`);
      const records = [];
      if(records.length){
        const ledger = records.pop();
        console.log(`received ledger ${ledger.paging_token}, sequence ${ledger.sequence}, closed at ${ledger.closed_at}`);
      }
    }
    console.log(`broke from while loop`);
  }

  var ES = BS;/*async function(url){
    console.log(`trying to ES from ${url}`);
    const response = await fetch(url, { method: "GET", headers: {"Accept": "text/event-stream"}});
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    while (true) {
      console.log(`setting timeOut to -${this.retry}- milliseconds at `, new Date());
      await new Promise((resolve, reject) => setTimeout(()=>resolve(), this.retry));
      console.log(`timed out at `, new Date());
      const { value, done } = await reader.read();
      console.log(`reader read at `, new Date());
      if (done) break;
      //const records = JSON.parse(decoder.decode(value))._embedded.records;//._embedded.records.pop();
      const received = decoder.decode(value);
      const lines = received.split(`\n`);
      for(const line of lines){
        console.log(`reading line - `, line);
        if(line.startsWith('retry: ')){
          console.log(`setting retry to: `, line.slice('retry: '.length));
          this.retry = 5000;//parseInt(line.slice('retry: '.length));
        }
        if(line.startsWith('id: ')){
          console.log(`receiving record for ledger `, line.slice('id: '.length));
          this.onmessage();
        }
      }
      //console.log(`received ${decoder.decode(value)}`);
      const records = [];
      if(records.length){
        const ledger = records.pop();
        console.log(`received ledger ${ledger.paging_token}, sequence ${ledger.sequence}, closed at ${ledger.closed_at}`);
      }
    }
    console.log(`broke from while loop`);
  }.bind({retry: 1000});*/
}

export function EventSource(args){
  return new ES(args)
}

function abConcat(arrays){
  let length = arrays.reduce((acc, value) => acc + value.length, 0);
  let result = new Uint8Array(length);

  if (!arrays.length) return result;

  // for each array - copy it over result
  // next array is copied right after the previous one
  length = 0;
  for(let array of arrays) {
    result.set(array, length);
    length += array.length;
  }
  return result;
}

function mfdTextSegment(text){
  const bytes = new TextEncoder().encode(text);
  //console.log(`created TextEncoder of ${text}: `, bytes);
  if(bytes.length !== text.length)
    throw new Error(`Unexpected Unicode found in multipart/form-data text`)
  return bytes
}

export function mfdOpts(fileIshes){
  // filishes must be itterable
  const segments = [];
  const boundary = `-----------------XYZ${Date.now()}ABC`;
  const startOfPart = mfdTextSegment(`--${boundary}\r\n`);

  for(let fileIsh of fileIshes){
    const fileName = typeof fileIsh.name === 'string' && fileIsh.name.length > 0 ? ` filename="${fileIsh.name}"\r\n`: `\r\n`;
    segments.push(startOfPart);
    segments.push(mfdTextSegment(`Content-Disposition: form-data; name="file";${fileName}`));
    segments.push(mfdTextSegment(`Content-Type: ${fileIsh.type}\r\n\r\n`));
    segments.push(fileIsh.data);
    segments.push(mfdTextSegment('\r\n'));
  }
  segments.push(mfdTextSegment(`--${boundary}--`));
  
  const options = { 
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: abConcat(segments)
  };
  return options
}

export function request(url, options={}, logArray=[]){
  return new Promise(function(resolve, reject){
    if(logArray.length > 0)
      logArray[new Date().toISOString()] = `request to ${url.slice(0, url.indexOf('?'))}`;
    if(isBrowser){
      const req = new XMLHttpRequest();
      req.onreadystatechange = function (e) {
        if(req.readyState === XMLHttpRequest.DONE){
          var status = req.status;
          if(status === 0 || (status >= 200 && status < 400)){
            if(logArray.length > 0)
              logArray[new Date().toISOString()] = `request.status = ${status}`;
            resolve(req.response);
          }
          else {
            if(logArray.length > 0)
              logArray[new Date().toISOString()] = `request.status = ${status}`;
            console.error(`XMLHttpRequest unexpected termination status: ${status}`)
            reject(req.response);
          }
        }
      };
      req.addEventListener('error', e => console.error(`XMLHttpRequest produced error: `, e));
      if(options.hasOwnProperty('method') && options.method.toUpperCase() === 'POST')
        req.open('POST', url);
      else
        req.open('GET', url);

      if(options?.headers)
        for(let key of Object.keys(options.headers)){
          req.setRequestHeader(key, options.headers[key]);
          if(key === 'Accept' && options.headers[key] === "application/vnd.ipld.raw")
            req.responseType = "arraybuffer";
        }

     if(options?.body){
        req.send(options.body);
     }
      else{
        req.send();
      }
    }
    else { // before use this needs to condition options for post
      const req = https.request(url, options, (response) => {
        let data;
        if(options?.headers && 'Accept' in options.headers && options.headers.Accept === 'application/vnd.ipld.raw'){
          data = new Uint8Array();
          response.on('data', (chunk) => {
            data = abConcat([data, chunk]);
          });
        } else {
          data = '';
          response.on('data', (chunk) => {
              data = data + chunk.toString();
          });          
        }
      
        response.on('end', () => {
          if(logArray.length > 0)
            logArray[new Date().toISOString()] = `request.status = ${'completed'}`;
          resolve(data);
        });
        response.on('error', (error) => {
          if(logArray.length > 0)
            logArray[new Date().toISOString()] = `request.status = ${error.message}`;
          console.error('An http error', error);
          reject(error);
        });
      });
      req.on('error', (error) => {
        if(logArray.length > 0)
          logArray[new Date().toISOString()] = `request.status = ${error.message}`;
        console.error('An http error', error);
        reject(error);
      });
      if(options.hasOwnProperty('method') && options.method.toUpperCase() === 'POST')
        req.end(options?.body);
      else 
        req.end();
    }
  })
}