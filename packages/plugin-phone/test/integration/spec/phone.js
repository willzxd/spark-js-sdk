/**!
 *
 * Copyright (c) 2015-2016 Cisco Systems, Inc. See LICENSE file.
 */

import '../..';

import {assert} from '@ciscospark/test-helper-chai';
import sinon from '@ciscospark/test-helper-sinon';
import CiscoSpark from '@ciscospark/spark-core';
import testUsers from '@ciscospark/test-helper-test-users';
import transform from 'sdp-transform';
import {find} from 'lodash';

if (process.env.NODE_ENV !== `test`) {
  throw new Error(`Cannot run the plugin-phone test suite without NODE_ENV === "test"`);
}

describe(`plugin-phone`, function() {
  this.timeout(60000);

  describe(`Phone`, () => {
    let mccoy, spock;
    before(() => testUsers.create({count: 2})
      .then((users) => {
        [mccoy, spock] = users;
        spock.spark = new CiscoSpark({
          credentials: {
            authorization: spock.token
          }
        });

        mccoy.spark = new CiscoSpark({
          credentials: {
            authorization: mccoy.token
          }
        });
        return Promise.all([
          spock.spark.phone.register(),
          mccoy.spark.phone.register()
        ]);
      }));

    let ringMccoy;
    beforeEach(() => {
      ringMccoy = sinon.spy();
      mccoy.spark.phone.on(`call:incoming`, ringMccoy);
    });

    after(() => Promise.all([
      spock && spock.spark.phone.deregister()
        .catch((reason) => console.warn(`could not disconnect spock from mercury`, reason)),
      mccoy && mccoy.spark.phone.deregister()
        .catch((reason) => console.warn(`could not disconnect mccoy from mercury`, reason))
    ]));

    describe(`#createLocalMediaStream()`, () => {
      it(`returns a MediaStreamObject`, () => {
        return spock.spark.phone.createLocalMediaStream()
          .then((stream) => {
            assert.instanceOf(stream, MediaStream);
          });
      });
    });

    describe(`#deregister()`, () => {
      let mercuryDisconnectSpy;
      beforeEach(() => {
        mercuryDisconnectSpy = sinon.spy(spock.spark.mercury, `disconnect`);
      });

      afterEach(() => mercuryDisconnectSpy.restore());

      it(`disconnects from mercury`, () => {
        return spock.spark.phone.deregister()
          .then(() => assert.calledOnce(mercuryDisconnectSpy))
          .then(() => assert.isFalse(spock.spark.mercury.connected, `Mercury is not connected`))
          .then(() => assert.isFalse(spock.spark.phone.connected, `Mercury (proxied through spark.phone) is not connected`))
          .then(() => mercuryDisconnectSpy.restore());
      });

      it(`unregisters from wdm`, () => spock.spark.phone.deregister()
        .then(() => assert.isUndefined(spock.spark.device.url)));

      it(`is a noop when not registered`, () => assert.isFulfilled(spock.spark.phone.deregister()
        .then(() => spock.spark.phone.deregister())));
    });

    describe(`#dial()`, () => {
      let call;

      // FIXME seems to fail in firefox. I think I've confirmed that FF doesn't
      // include h264 in video-only calls
      it.skip(`initiates a video only call`, () => {
        call = spock.spark.phone.dial(mccoy.email, {
          constraints: {
            video: true,
            audio: false
          }
        });

        return mccoy.spark.phone.when(`call:incoming`)
          .then(() => {
            const sdp = transform.parse(call.pc.localDescription.sdp);
            assert.notOk(find(sdp.media, {type: `audio`}));
            assert.equal(find(sdp.media, {type: `video`}).direction, `sendrecv`);
          });
      });

      it(`initiates an audio only call`, () => {
        call = spock.spark.phone.dial(mccoy.email, {
          constraints: {
            video: false,
            audio: true
          }
        });

        return mccoy.spark.phone.when(`call:incoming`)
          .then(() => {
            const sdp = transform.parse(call.pc.localDescription.sdp);
            assert.notOk(find(sdp.media, {type: `video`}));
            assert.equal(find(sdp.media, {type: `audio`}).direction, `sendrecv`);
          });
      });

      it(`initiates a receive-only call`, () => {
        call = spock.spark.phone.dial(mccoy.email, {
          constraints: {
            video: false,
            audio: false
          },
          offerOptions: {
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
          }
        });

        return mccoy.spark.phone.when(`call:incoming`)
          .then(() => {
            const sdp = transform.parse(call.pc.localDescription.sdp);
            assert.equal(find(sdp.media, {type: `audio`}).direction, `recvonly`);
            assert.equal(find(sdp.media, {type: `video`}).direction, `recvonly`);
          });
      });

      it(`calls a user by email address`, () => {
        spock.spark.phone.dial(mccoy.email);
        return mccoy.spark.phone.when(`call:incoming`)
          .then(() => assert.calledOnce(ringMccoy));
      });

      it(`calls a user by AppID username`);

      it.skip(`calls a PSTN phone number`, () => {
        // TODO
        const call = spock.spark.phone.dial(`tel:...`);
      });

      it.skip(`calls a user by hydra room id`, () => spock.spark.request({
        method: `POST`,
        api: `hydra`,
        resource: `messages`,
        body: {
          toPersonEmail: mccoy.email,
          text: `test message`
        }
      })
        .then((res) => new Promise((resolve, reject) => {
          const call = spock.spark.phone.dial(res.body.roomId);
          call.on(`error`, reject);
          resolve(mccoy.spark.phone.when(`call:incoming`));
        }))
        .then(() => assert.calledOnce(ringMccoy)));

      it(`calls a user by room url`);

      it(`calls a user by hydra user id`);

      it(`calls a user by uuid`);

      it(`calls a user by sip uri`, () => {
        // TODO
        const call = spock.spark.phone.dial(`sip:...`);
      });

      it(`places a call with an existing MediaStreamObject`, () => {
        return spock.spark.phone.createLocalMediaStream()
          .then((localMediaStream) => {
            const call = spock.spark.phone.dial(mccoy.email, {localMediaStream});
            return mccoy.spark.phone.when(`call:incoming`, ([c]) => c.answer())
              .then(() => assert.equal(call.localMediaStream, localMediaStream));
          });
      });
    });

    describe(`#register()`, () => {
      let kirk;
      beforeEach(() => testUsers.create({count: 1})
        .then(([user]) => {
          kirk = user;
          kirk.spark = new CiscoSpark({
            credentials: {
              authorization: kirk.token
            }
          });
        }));

      afterEach(() => kirk && kirk.spark.phone.deregister());

      it(`registers with wdm`, () => {
        return kirk.spark.phone.register()
          .then(() => assert.isDefined(kirk.spark.device.url));
      });

      it(`connects to mercury`, () => {
        assert.isFalse(kirk.spark.mercury.connected, `Mercury is not connected`);
        assert.isFalse(kirk.spark.phone.connected, `Mercury (proxied through spark.phone) is not conneted`);

        return kirk.spark.phone.register()
          .then(() => {
            assert.isTrue(kirk.spark.mercury.connected, `Mercury is connected after calling register`);
            assert.isTrue(kirk.spark.phone.connected, `spark.phone.connected proxies to spark.mercury.connected`);
          });
      });

      let call;
      afterEach(() => Promise.resolve(call && call.hangup()
        .catch((reason) => console.warn(`failed to end call`, reason))
        .then(() => {call = undefined;})));

      // TODO make this preventable
      it(`fetches active calls`, () => {
        call = spock.spark.phone.dial(kirk.email);
        // use change:locus as the trigger for determining when the post to
        // /call completes.
        return call.when(`change:locus`)
          .then(() => {
            assert.isFalse(kirk.spark.phone.registered);
            kirk.spark.phone.register();
            return kirk.spark.phone.when(`call:incoming`)
              .then(() => assert.isTrue(kirk.spark.phone.registered, `By the time spark.phone can emit call:incoming, spark.phone.registered must be true`));
          });
      });

      it(`is a noop when already registered`, () => assert.isFulfilled(spock.spark.phone.register()));
    });

    describe(`#defaultFacingMode`, () => {
      it.skip(`defaults to user`, () => {
        assert.equal(spock.spark.phone.defaultFacingMode, `user`);
      });

      describe(`when video constraints are not specified`, () => {
        it(`gets passed as the video constraint`);
      });

      describe(`when video constraints are not specified`, () => {
        it(`does not get passed as the video constraint`);
      });
    });

    describe(`when a call is received`, () => {
      it(`emits a call:incoming event`, () => {
        spock.spark.phone.dial(mccoy.email);
        return mccoy.spark.phone.when(`call:incoming`)
          .then(() => assert.calledOnce(ringMccoy));
      });
    });
  });
});

// TODO needs tests that go from no media only to audio/video

// TODO move to ciscospark/spark-core
// describe(`.init()`, () => {
//   it(`initializes the sdk with an access_token`);
//   it(`initializes the sdk with a refresh_token`);
//   it(`initializes the sdk with an AppID`);
// });
//
// describe(`.version`, () => {
//   it(`provides the current semantic version of the sdk`);
// });
