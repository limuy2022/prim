import Chat from "./components/chat/Chat";
import Contacts from "./components/contacts/Contacts";
import More from "./components/more/More";
import './App.css'
import { GlobalContext, UserMsgListItemData } from "./context/GlobalContext";
import { createRef, ReactNode } from "react";
import { Msg, Type } from "./entity/msg";
import React from "react";
import { randomMsg } from "./mock/chat";
import Login from "./components/login/Login";
import { Client } from "./net/core";
import { KVDB, MsgDB } from "./service/database";
import { HttpClient } from "./net/http";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { UserInfo } from "./service/user/userInfo";

class Props { }

class State {
    userMsgList: Array<UserMsgListItemData> = [];
    msgMap: Map<bigint, Msg[]> = new Map();
    userId: bigint = 1n;
    currentChatMsgList: Array<Msg> = [];
    currentChatPeerId: bigint = 0n;
    unAckSet: Set<string> = new Set();
    savedAckMap: Map<bigint, bigint> = new Map();
    loginRedirect: () => void = () => { };
}

class App extends React.Component<Props, State> {
    netConn: Client | undefined;
    loginRedirect: React.RefObject<any>;
    constructor(props: any) {
        super(props);
        this.state = new State();
        this.loginRedirect = createRef();
    }

    clearState = () => {
        this.setState({
            userMsgList: [],
            msgMap: new Map(),
            userId: 0n,
            currentChatMsgList: [],
            currentChatPeerId: 0n,
            unAckSet: new Set(),
            savedAckMap: new Map(),
        });
    }

    peerId = (id1: bigint, id2: bigint) => {
        if (this.state.userId === id1) {
            return id2;
        } else {
            return id1;
        }
    }

    setLoginRedirect = (redirect: () => void) => {
        this.setState({ loginRedirect: redirect });
    }

    setUserMsgListItemUnread = async (peerId: bigint, unread: boolean) => {
        let list = this.state.userMsgList;
        let newList = list.map((item) => {
            if (item.peerId === peerId) {
                item.unreadNumber = unread ? 1 : 0;
            }
            return item;
        });
        this.setState({ userMsgList: newList }, async () => {
            await this._saveUserMsgList();
        });
    }

    setUserId = (userId: bigint) => {
        this.setState({ userId: userId });
    }

    setCurrentChatPeerId = (peerId: bigint) => {
        let list = this.state.msgMap.get(peerId)
        if (list === undefined) {
            list = [];
            this.state.msgMap.set(peerId, list);
        }
        this.setState({ currentChatMsgList: [...list] });
        this.setState({ currentChatPeerId: peerId });
        this.setUserMsgListItemUnread(peerId, false);
    }

    removeUserMsgListItem = async (peerId: bigint) => {
        let list = this.state.userMsgList;
        let newList = list.filter((item) => {
            return item.peerId !== peerId;
        });
        this.setState({ userMsgList: newList }, async () => {
            await this._saveUserMsgList();
        });
    }

    _setUserMsgList = async (msg: Msg): Promise<Array<UserMsgListItemData>> => {
        let peerId = this.peerId(msg.head.sender, msg.head.receiver);
        let text = msg.payloadText();
        let timestamp = msg.head.timestamp;
        let [avatar, remark] = await UserInfo.avatarRemark(this.state.userId, peerId);
        let number = 0;
        let list = this.state.userMsgList;
        let newList
        let item = list.find((item) => {
            return item.peerId === peerId;
        });
        // Ack will trigger resort of user msg list
        if (msg.head.type === Type.Ack) {
            if (item !== undefined) {
                number = item.unreadNumber;
                newList = [new UserMsgListItemData(peerId, avatar, remark, item.preview, timestamp, number), ...list.filter((item) => {
                    return item.peerId !== peerId;
                })]
            } else {
                newList = list;
            }
        } else {
            if (item !== undefined) {
                if (msg.head.timestamp > item.timestamp) {
                    if (msg.head.sender === peerId) {
                        number = item.unreadNumber + 1;
                    } else {
                        number = item.unreadNumber;
                    }
                    newList = [new UserMsgListItemData(peerId, avatar, remark, text, timestamp, number), ...list.filter((item) => {
                        return item.peerId !== peerId;
                    })]
                } else {
                    newList = list;
                }
            } else {
                if (msg.head.sender === peerId) {
                    number = 1;
                } else {
                    number = 0;
                }
                newList = [new UserMsgListItemData(peerId, avatar, remark, text, timestamp, number), ...list];
            }
        }
        newList = newList.sort((a, b) => {
            return Number(b.timestamp - a.timestamp);
        });
        this.setState({ userMsgList: newList }, async () => {
            await this._saveUserMsgList();
        });
        return newList;
    }

    _setMsgMap = async (msg: Msg) => {
        let peerId = this.peerId(msg.head.sender, msg.head.receiver);
        let map = this.state.msgMap;
        let list = map.get(peerId);
        if (msg.head.type === Type.Ack) {
            let timestamp = BigInt(msg.payloadText())
            if (list !== undefined) {
                for (let i = list.length - 1; i >= 0; --i) {
                    if (list[i].head.sender === msg.head.sender && list[i].head.receiver === msg.head.receiver && list[i].head.timestamp === timestamp) {
                        list[i].head.timestamp = msg.head.timestamp;
                        list[i].head.seqNum = msg.head.seqNum;
                        await this._saveMsg(list[i]);
                        break;
                    }
                }
            } else {
                return;
            }
        } else {
            if (list === undefined) {
                list = new Array();
                list.push(msg);
                map.set(peerId, list);
            } else {
                list.push(msg);
            }
            if (msg.head.seqNum !== 0n) {
                await this._saveMsg(msg);
            }
        }
        let list1 = list.filter((item) => {
            return item.head.seqNum !== 0n;
        });
        let list2 = list.filter((item) => {
            return item.head.seqNum === 0n;
        });
        list1.sort((a, b) => {
            return Number(a.head.seqNum - b.head.seqNum);
        });
        list2.sort((a, b) => {
            return Number(a.head.timestamp - b.head.timestamp);
        });
        let newList = [...list1, ...list2];
        map.set(peerId, newList);
        if (peerId === this.state.currentChatPeerId) {
            this.setState({ currentChatMsgList: newList });
        }
    }

    _setUnSetAckSet = (msg: Msg) => {
        let set = this.state.unAckSet;
        if (msg.head.type === Type.Ack) {
            let key = msg.head.sender + "-" + msg.head.receiver + "-" + msg.payloadText();
            set.delete(key);
            let newSet = new Set(set);
            this.setState({ unAckSet: newSet });
        } else {
            let key = msg.head.sender + "-" + msg.head.receiver + "-" + msg.head.timestamp;
            if (msg.head.seqNum === 0n) {
                setTimeout(() => {
                    set.add(key);
                    this.setState({ unAckSet: set });
                }, 3000)
            }
        }
    }

    _newMsg = async (msg: Msg): Promise<Array<UserMsgListItemData>> => {
        await this._setMsgMap(msg);
        this._setUnSetAckSet(msg);
        let list = await this._setUserMsgList(msg);
        return list;
    }

    sendMsg = async (msg: Msg) => {
        this._newMsg(msg)
        await this.netConn?.send(msg);
    }

    recvMsg = (msg: Msg) => {
        this._newMsg(msg);
    }

    _saveMsg = async (msg: Msg) => {
        await MsgDB.saveMsg(msg);
    }

    _saveUserMsgList = async () => {
        await KVDB.set('user-msg-list-' + this.state.userId, this.state.userMsgList);
    }

    loadMore = async () => {
        let seqNum = 0n;
        let index = 0;
        while (seqNum === 0n && index < this.state.currentChatMsgList.length) {
            seqNum = this.state.currentChatMsgList[index++].head.seqNum;
        }
        if (seqNum === 0n) {
            return;
        }
        let list = await MsgDB.getMsgList(this.state.userId, this.state.currentChatPeerId, seqNum - 100n, seqNum);
        if (list.length < 100) {
            if (list.length !== 0) {
                seqNum = list[0].head.seqNum;
            }
            let resp = await HttpClient.get("/message/history", {
                peer_id: this.state.currentChatPeerId,
                from_seq_num: seqNum - (100n - BigInt(list.length)),
                to_seq_num: seqNum,
            }, true);
            if (!resp.ok) {
                console.log(resp.errMsg);
                return;
            }
            let msgList = resp.data as Array<any>;
            msgList.forEach((item) => {
                let arr = item as Array<number>;
                let body = new Uint8Array(arr.length);
                for (let i = 0; i < arr.length; ++i) {
                    body[i] = arr[i];
                }
                let msg = Msg.fromArrayBuffer(body.buffer);
                list.push(msg);
            });
        }
        list.forEach((item) => {
            this._newMsg(item);
        });
    }

    checkCurrentChatMsgList = async (size: number): Promise<void> => {
        let list = this.state.currentChatMsgList;
        if (size > list.length) {
            return;
        }
        let appendList = new Array<Msg>();
        for (let i = 0; i < size; ++i) {
            if (list[i].head.seqNum === 0n) {
                return;
            }
            if (list[i].head.seqNum + 1n === list[i + 1].head.seqNum) {
                continue;
            }
            let fromSeqNum = list[i].head.seqNum + 1n;
            let toSeqNum = list[i + 1].head.seqNum;
            let resp = await HttpClient.get("/message/history", {
                peer_id: this.state.currentChatPeerId,
                from_seq_num: fromSeqNum,
                to_seq_num: toSeqNum,
            }, true);
            if (!resp.ok) {
                return;
            }
            let msgList = resp.data as Array<any>;
            msgList.forEach((item) => {
                let arr = item as Array<number>;
                let body = new Uint8Array(arr.length);
                for (let i = 0; i < arr.length; ++i) {
                    body[i] = arr[i];
                }
                let msg = Msg.fromArrayBuffer(body.buffer);
                appendList.push(msg);
            });
        }
        appendList.forEach((item) => {
            this._newMsg(item);
        });
    }

    setup = async () => {
        let token = await KVDB.get("access-token");
        let userId = await KVDB.get("user-id");
        if (token === undefined || userId === undefined) {
            this.state.loginRedirect();
            return;
        } else {
            let resp = await HttpClient.put('/user', {}, {}, true);
            if (!resp.ok) {
                this.state.loginRedirect();
                return;
            }
            this.setState({ userId: BigInt(userId) });
        }
        this.setUserId(BigInt(userId));
        let resp = (await HttpClient.get("/which_address", {}, true))
        if (!resp.ok) {
            alert("unknown error")
            return;
        }
        let address = resp.data as string;
        console.log(address);
        // @todo mode switch
        this.netConn = new Client(address, token as string, "udp", BigInt(userId), 0, this.recvMsg);
        let list = await this.inbox();
        list = await this.mergeUserMsgList(list);
        list = await this.syncMsgList(list);
        await this.updateUnread(list);
        await this.netConn.connect();
        let [avatar, _nickname] = await UserInfo.avatarNickname(userId);
        await KVDB.set("avatar", avatar);
    }

    inbox = async (): Promise<Array<UserMsgListItemData>> => {
        let inboxResp = await HttpClient.get("/message/inbox", {}, true);
        if (!inboxResp.ok) {
            console.log(inboxResp.errMsg);
            alert("unknown error")
            return Promise.reject();
        }
        let list = inboxResp.data as Array<any>;
        let res = new Array<UserMsgListItemData>();
        for (let i = 0; i < list.length; ++i) {
            let peerId = BigInt(list[i]);
            let userMsgItem = new UserMsgListItemData(peerId, "", "", "", 0n, 0);
            res.push(userMsgItem);
        }
        return res;
    }

    mergeUserMsgList = async (inboxList: Array<UserMsgListItemData>): Promise<Array<UserMsgListItemData>> => {
        let obj = await KVDB.get('user-msg-list-' + this.state.userId);
        if (obj === undefined) {
            obj = [];
        }
        let list = new Array<UserMsgListItemData>();
        obj.forEach((value: any) => {
            let item = new UserMsgListItemData(BigInt(value.peerId), value.avatar as string, value.remark as string, value.text as string, BigInt(value.timestamp), Number(value.unreadNumber));
            list.push(item);
        });
        let map = new Map<BigInt, UserMsgListItemData>();
        for (let i = 0; i < list.length; ++i) {
            map.set(list[i].peerId, list[i]);
        }
        for (let i = 0; i < inboxList.length; ++i) {
            map.set(inboxList[i].peerId, inboxList[i]);
        }
        let res = new Array<UserMsgListItemData>();
        map.forEach((value: UserMsgListItemData, key: BigInt) => {
            res.push(value);
        });
        res.sort((a: UserMsgListItemData, b: UserMsgListItemData) => {
            return Number(a.timestamp - b.timestamp);
        });
        this.setState({ userMsgList: res });
        console.log(this.state.userMsgList);
        return res;
    }

    syncMsgList = async (list: Array<UserMsgListItemData>): Promise<Array<UserMsgListItemData>> => {
        let newList = this.state.userMsgList;
        for (let i = 0; i < list.length; ++i) {
            let item = list[i];
            let fromSeqNum = await MsgDB.latestSeqNum(item.peerId, this.state.userId);
            let seqNum = fromSeqNum < 100n ? 1n : fromSeqNum - 100n;
            // load msg from local storage
            let localList = await MsgDB.getMsgList(item.peerId, this.state.userId, seqNum, fromSeqNum + 1n);
            for (let j = localList.length - 1; j >= 0; --j) {
                newList = await this._newMsg(localList[j]);
            }
            // load msg from server
            let resp = await HttpClient.get("/message/history", {
                peer_id: item.peerId,
                from_seq_num: fromSeqNum + 1n,
                to_seq_num: 0,
            }, true);
            if (!resp.ok) {
                console.log(resp.errMsg);
                continue;
            }
            let msgList = resp.data as Array<any>;
            for (let j = 0; j < msgList.length; ++j) {
                let arr = msgList[j] as Array<number>;
                let body = new Uint8Array(arr.length);
                for (let i = 0; i < arr.length; ++i) {
                    body[i] = arr[i];
                }
                let msg = Msg.fromArrayBuffer(body.buffer);
                newList = await this._newMsg(msg);
            }
        }
        return newList;
    }

    updateUnread = async (list: Array<UserMsgListItemData>): Promise<void> => {
        let newList = new Array<UserMsgListItemData>();
        for (let i = 0; i < list.length; ++i) {
            let item = list[i];
            let resp = await HttpClient.get("/message/unread", {
                peer_id: item.peerId,
            }, true);
            if (!resp.ok) {
                console.log(resp.errMsg);
                newList.push(item);
                continue;
            }
            let unreadSeqNum = BigInt(resp.data);
            let lastSeqNum = await MsgDB.latestSeqNum(item.peerId, this.state.userId);
            console.log(unreadSeqNum, lastSeqNum);
            if (unreadSeqNum <= lastSeqNum) {
                item.unreadNumber = Number(lastSeqNum - unreadSeqNum);
            }
            newList.push(item);
        }
        console.log(newList);
        this.setState({ userMsgList: newList });
    }

    componentDidMount = async () => {
        await KVDB.set('avatar-1', '/assets/avatar/default-avatar-1.png');
        await KVDB.set('avatar-4', '/assets/avatar/default-avatar-4.png');
        await KVDB.set('nickname-1', 'user-1');
        await KVDB.set('nickname-4', 'user-4');
        await KVDB.set('remark-1-4', 'user-4-of-user-1');
        await KVDB.set('remark-4-1', 'user-1-of-user-4');
        console.log("kvdb done");
        await this.setup();
    }

    disconnect = async () => {
        if (this.netConn !== undefined) {
            await this.netConn.disconnect();
        }
    }

    componentWillUnmount = async () => {
        await this.disconnect();
    }

    render(): ReactNode {
        return (
            <div id={"root"}>
                <GlobalContext.Provider value={{
                    userMsgList: this.state.userMsgList,
                    msgMap: this.state.msgMap,
                    userId: this.state.userId,
                    currentChatMsgList: this.state.currentChatMsgList,
                    currentChatPeerId: this.state.currentChatPeerId,
                    unAckSet: this.state.unAckSet,
                    setCurrentChatPeerId: this.setCurrentChatPeerId,
                    sendMsg: this.sendMsg,
                    setUnread: this.setUserMsgListItemUnread,
                    setLoginPageDirect: this.setLoginRedirect,
                    setup: this.setup,
                    disconnect: this.disconnect,
                    clearState: this.clearState,
                    loadMore: this.loadMore,
                    removeUserMsgListItem: this.removeUserMsgListItem,
                }}>
                    <BrowserRouter>
                        <Routes>
                            <Route path="/login" element={<Login></Login>} />
                            <Route path="/" element={<Chat></Chat>} />
                            <Route path="/contacts" element={<Contacts></Contacts>} />
                            <Route path="/more" element={<More></More>} />
                        </Routes>
                    </BrowserRouter>
                </GlobalContext.Provider>
            </div>
        )
    }
}

export default App;