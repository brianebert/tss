import {request} from './http.js';

const HORIZON = 'https://horizon.stellar.org';
const API_PAGE_SIZE = 100; // 100 is max size
const API_CALL_DEPTH = 5;  // avoid stack overflow

// reads Stellar Horizon api from cursor until recursionDepth
// or untl() returns true. Maintains reference to recordQueue.
export class ApiReader {
  #recordQueue; #recursionDepth; #until;
  constructor(type, until, joinTx=false){
    this.#until = until;
    this.url = `${HORIZON}/${type}?limit=${API_PAGE_SIZE}`;
    if(joinTx)
      this.url += '&join=transactions';
  }

  // pages through api from cursor
  nextRecords(cursor=null){
    this.#recursionDepth++;
    return request(cursor === null ? this.url : `${this.url}&cursor=${cursor}`)
      .then(response => {
        let records = JSON.parse(response)._embedded.records;
        if(records.length){
          for(let i=0; i < records.length; i++)
            if(this.#until(records[i]))
              return records[i].paging_token;
          if(records.length === API_PAGE_SIZE && this.#recursionDepth <= API_CALL_DEPTH)
            return this.nextRecords(records.pop().paging_token)
          if(this.#recursionDepth > API_CALL_DEPTH)
            throw new Error(`call to ${this.url} exceeded API_CALL_DEPTH of ${API_CALL_DEPTH}`)
          return records.pop().paging_token
        }
        return cursor
      })
      .catch(err => {
        console.error(`apiReader caused Error: `, err);
      })
  }

  // directs reader to a specific cursor
  readFrom(cursor){
    this.#recordQueue = [];
    this.#recursionDepth = 0;
    return this.nextRecords(cursor)
      .then(cursor => ({recursionDepth: this.#recursionDepth,
                        recordQueue: this.#recordQueue,
                        cursor: cursor}))
  }

  // access to recordQueue
  get recordQueue(){
    return this.#recordQueue;
  }
}

// reads api in last first order
export class ApiDigger extends ApiReader {
  constructor(type, until, joinTx){
    super(type, until, joinTx);
    this.url += '&order=desc';
  }

  dig(done){
    return this.readFrom().then(readerResponse => typeof done === 'function' ? done(readerResponse) : '')
  }
}

// checks api for new information periodically by time or each tome a ledger closes
export class ApiWatcher extends ApiReader {
  #cursor; #trigger;
  constructor(type, until, joinTx){
    super(type, until, joinTx);
  }

  // starts reading when triggered and calls done on response
  reader(done){
    return this.readFrom(this.#cursor)
               .then(readerResponse => {
                  this.#cursor = readerResponse.cursor;
                  if(typeof done === 'function')
                    done(readerResponse);
               })
  }

  // triggers api read by ledger close
  byBlock(done){
    return Promise.all([request(`${this.url.slice(0, this.url.indexOf('?'))}?order=desc&limit=${1}`), 
                        request(`${HORIZON}/ledgers?order=desc&limit=${1}`)])
      .then(([cursor, ledger]) => {
        this.#cursor = JSON.parse(cursor)._embedded.records.pop().paging_token;
        this.#trigger = new EventSource(`${HORIZON}/ledgers?cursor=${JSON.parse(ledger)._embedded.records.pop().paging_token}`);
        this.#trigger.onmessage = (e) => this.reader(done);
        return this
      })
  }

  // triggers api read by time interval
  byTime(interval, done){
    // replace url query string to find current paging token
    return request(`${this.url.slice(0, this.url.indexOf('?'))}?order=desc&limit=${1}`)
      .then(response => {
        this.#cursor = JSON.parse(response)._embedded.records.pop().paging_token;
        this.#trigger = setInterval(() => this.reader(done), interval * 1000);
        return this
      })
  }
}

// digs api of a specific accountId
export class AccountDigger extends ApiDigger {
  constructor(accountId, type, until, joinTx){
    super(type, until, joinTx);
    this.url = this.url.slice(0, HORIZON.length) + `/accounts/${accountId}` + this.url.slice(HORIZON.length)
  } 
}

// watchess api of a specific accountId
export class AccountWatcher extends ApiWatcher {
  constructor(accountId, type, until, joinTx){
    super(type, until, joinTx);
    this.url = this.url.slice(0, HORIZON.length) + `/accounts/${accountId}` + this.url.slice(HORIZON.length)
  }
}