//const {request} = require('./http.js');
import {request, EventSource} from './http.js';
const HORIZON = 'https://horizon.stellar.org';
const API_PAGE_SIZE = 100;
// reading api is recursive, avoid stack overflow
const API_CALL_DEPTH = 5;

export class ApiReader {
  #recordQueue; #recursionDepth; #until;
  constructor(type, until, joinTx=false){
    this.#until = until;
    this.url = `${HORIZON}/${type}?limit=${API_PAGE_SIZE}`;
    if(joinTx)
      this.url += '&join=transactions';
  }

  nextRecords(cursor=null){
    this.#recursionDepth++;
    return request(cursor ? `${this.url}&cursor=${cursor}` : this.url)
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

  readFrom(cursor){
    this.#recordQueue = [];
    this.#recursionDepth = 0;
    return this.nextRecords(cursor)
      .then(cursor => ({recursionDepth: this.#recursionDepth,
                        recordQueue: this.#recordQueue,
                        cursor: cursor}))
  }

  get recordQueue(){
    return this.#recordQueue;
  }
}

export class ApiDigger extends ApiReader {
  constructor(type, until, joinTx){
    super(type, until, joinTx);
    this.url += '&order=desc';
  }

  dig(done){
    return this.readFrom().then(readerResponse => typeof done === 'function' ? done(readerResponse) : '')
  }
}

export class ApiWatcher extends ApiReader {
  #cursor; #trigger;
  constructor(type, until, joinTx){
    super(type, until, joinTx);
  }

  reader(done){
    return this.readFrom(this.#cursor)
               .then(readerResponse => {
                  this.#cursor = readerResponse.cursor;
                  if(typeof done === 'function')
                    done(readerResponse);
               })
  }

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

export class AccountDigger extends ApiDigger {
  constructor(accountId, type, until, joinTx){
    super(type, until, joinTx);
    this.url = this.url.slice(0, HORIZON.length) + `/accounts/${accountId}` + this.url.slice(HORIZON.length)
  } 
}

export class AccountWatcher extends ApiWatcher {
  constructor(accountId, type, until, joinTx){
    super(type, until, joinTx);
    this.url = this.url.slice(0, HORIZON.length) + `/accounts/${accountId}` + this.url.slice(HORIZON.length)
  }
}