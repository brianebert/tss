import {Keypair, Operation, StrKey} from '@stellar/stellar-base';
import {StellarAccount} from './signing.js';

export class ContentPointer extends StellarAccount{
    #ready; #account;
    constructor(id=null, address=null, sponsor=null){
        if(StrKey.isValidEd25519PublicKey(id)){
            var kp = Keypair.fromPublicKey(id);
            var create = false;
        }
        else if(!!sponsor && !!address){
            var kp = Keypair.random();
            var create = true;
        }
        else
            throw new Error(`ContentPointer requires valid Stellar Id or signing account to create.`)
        super(kp.publicKey());
        this.#ready = create ? sponsor.tx(
            [
                Operation.beginSponsoringFutureReserves({
                    sponsoredId: this.id
                }),
                Operation.createAccount({
                    destination: this.id,
                    startingBalance: '0'
                }),
                Operation.manageData({
                    name: 'index',
                    value: '0',
                    source: this.id
                }),
                Operation.manageData({
                    name: 'address',
                    value: address,
                    source: this.id
                }),
                Operation.setOptions({
                    signer: {
                        ed25519PublicKey: sponsor.id,
                        weight: 255
                    },
                    source: this.id
                }),
                Operation.endSponsoringFutureReserves({
                    source: this.id
                })
            ],
            false,
            [kp]
        )
        .then(async () => this.#account = await StellarAccount.load(kp.publicKey())) :
        StellarAccount.load(id);
    }

    canSignMe(sponsor){
        if(Array.from(this.#account.signers).filter(signer => signer.key === sponsor.id).length !== 1)
            throw new Error(`ContentPointer ${this.id} is not sponsored by ${sponsor.id}`);
        return true
    }

    // All getters return promises
    get ready(){
        return this.#ready;
    }

    // All getters return promises
    get address(){
        return this.#ready.then(account => 
            Buffer.from(account.data.address, 'base64')
                  .toString('ascii')
        )
    }

    // All getters return promises
    get index(){
        return this.#ready.then(account => 
            Buffer.from(account.data.index, 'base64')
                  .toString('ascii')
        )
    }

    static async merge(sponsor, ids){
        let ops = [];
        if(ids.length === 0)
            return Promise.resolve({id: "NA", successful: true});
        if(ids.length > 33)
            throw new Error(`Cannot merge more than 33 ContentPointers at once`);
        for(const id of ids){
            const sponsee = await StellarAccount.load(id);
            if(Array.from(sponsee.signers).filter(signer => signer.key === sponsor.id).length !== 1)
                throw new Error(`Account ${id} is not sponsored by ${sponsor.id}`);
            console.log(`merging ContentPointer ${id} into sponsor: ${sponsor.id}`);
            ops.push(
                Operation.manageData({
                    name: 'index',
                    value: null,
                    source: id
                }),
                Operation.manageData({
                    name: 'address',
                    value: null,
                    source: id
                }),
                Operation.accountMerge({
                    destination: sponsor.id,
                    source: id
                })
            );
        }
        return sponsor.tx(ops).then(result => {
            console.log(`merge result is: `, result);
            return result;
        });
    }

    static async update(sponsor, updates){
        const ops = []; const merges = [];
        for(const [ptr, value] of updates){
            console.log(`updating ${ptr.id} with value: `, value);
            if(!!value){
                ops.push(
                    Operation.manageData({
                        name: 'index',
                        value: (parseInt(await ptr.index) + 1).toString(),
                        source: ptr.id
                    }),
                    Operation.manageData({
                        name: 'address',
                        value: value.toString(),
                        source: ptr.id
                    })
                );
            }
            else{
                merges.push(ptr.id);
            }
        }
        return Promise.all([sponsor.tx(ops), ContentPointer.merge(sponsor, merges)])
        .then(([result, mergeResult]) => {
            console.log(`update result is: `, result);
            console.log(`merge result is: `, mergeResult);
            return result;
        })
    }
}

/* Below was used to test class
import {SigningAccount} from './signing.js';
import {Keypair} from '@stellar/stellar-base';
const sponsor_keys = Keypair.fromSecret('SAEIC2BBP7OPQ22O42COL73VOFEYI2AR42UI6BGR3EK7IAQOH3XZN5O6');
const sponsored_keys = Keypair.random();
const sponsor = new SigningAccount(sponsor_keys.publicKey(), sponsor_keys.secret());
let sponsored;
sponsor.ready
.then(() => sponsored = new SponsoredAccount(sponsor, sponsored_keys))
.then(async sponsored => await sponsored.ready)
.then(async () => console.log(`sponsored account index: `, await sponsored.index))
.then(() => SponsoredAccount.merge(sponsor, sponsored.id))
.catch(err => console.error(`error: `, err));*/