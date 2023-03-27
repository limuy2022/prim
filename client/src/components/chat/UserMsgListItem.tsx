import React, { ReactNode } from 'react';
import { Context, GlobalContext } from '../../context/GlobalContext';
import { HttpClient } from '../../net/http';
import './UserMsgListItem.css';

class Props {
    msg: string = "";
    peerId: bigint = 0n;
    avatar: string = "";
    timestamp: bigint = 0n
    number: number = 0;
    remark: string = "";
}

class State { }

class UserMsgListItem extends React.Component<Props, State> {
    static contextType = GlobalContext;

    constructor(props: any) {
        super(props);
        this.state = new State();
    }

    onClick = async () => {
        let context = this.context as Context;
        context.setCurrentChatPeerId(this.props.peerId);
        let msgList = context.msgMap.get(this.props.peerId);
        await context.setUnread(this.props.peerId, false)
        if (msgList !== undefined) {
            let seqNum = msgList[msgList.length - 1].head.seqNum;
            await HttpClient.put('/message/unread', {
                peer_id: this.props.peerId,
                last_read_seq: seqNum
            }, {}, true);
        }
    }

    onContextMenu = async (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
    }

    removeItem = async () => {
        let context = this.context as Context;
        await context.removeUserMsgListItem(this.props.peerId);
    }

    render(): ReactNode {
        const date = new Date(Number(this.props.timestamp));
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        let time = `${hours}:${minutes}`;
        return (
            <div className="user-msg-list-item" onContextMenu={this.onContextMenu}>
                <img src={this.props.avatar} alt="" className='u-m-l-item-avatar' onClick={this.removeItem} />
                <div className="u-m-l-item-remark" onClick={this.onClick}>
                    {
                        this.props.remark
                    }
                </div>
                <div className="u-m-l-item-msg" onClick={this.onClick}>
                    <span>
                        {this.props.msg}
                    </span>
                </div>
                <div className="u-m-l-item-timestamp" onClick={this.onClick}>
                    {
                        time
                    }
                </div>
                <div className="u-m-l-item-number" onClick={this.onClick}>
                    {
                        this.props.number > 0 ? (this.props.number > 99 ? <div className='number-0'>99+</div> : <div className='number-0'>{this.props.number}</div>) : ''
                    }
                </div>
                <div className='u-m-l-item-a'>
                </div>
            </div>
        )
    }
}

export default UserMsgListItem;